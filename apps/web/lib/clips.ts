import type { Sql } from 'postgres'
import {
  DEFAULT_EDIT_SPEC,
  normalizeEditSpecV3,
  type EditSpecV3,
  type TimelineContext,
  type TranscriptWord,
} from '@klipmatic/engine'
import type { ClipEditorPayload, ClipPreviewStatus, ResolvedMediaAsset } from './clipTypes'
import {
  referencedAssetIds,
  resolveProjectAssets,
  touchProjectAssets,
} from './mediaAssets'
import { readR2Json, readR2JsonIfExists } from './r2'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RENDER_STATUSES = ['draft', 'rendering', 'done', 'failed'] as const
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export class ClipNotFoundError extends Error {}

function timelineContext(
  id: unknown,
  startSec: unknown,
  endSec: unknown,
  candidateAssetId: string,
  assets: ResolvedMediaAsset[],
): TimelineContext {
  return {
    sourceId: String(id),
    candidateDuration: Number(endSec) - Number(startSec),
    candidateAssetId,
    assets: Object.fromEntries(assets.map((asset) => [asset.id, {
      id: asset.id,
      mediaType: asset.mediaType,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
    }])),
  }
}

async function upsertCandidateAsset(
  sql: Sql,
  input: {
    userId: string
    projectId: string
    clipId: string
    name: string
    duration: number
    ready: boolean
    failed: boolean
    bytes: number
    url: string | null
  },
): Promise<ResolvedMediaAsset> {
  const status = input.ready ? 'ready' : input.failed ? 'failed' : 'uploading'
  const [row] = await sql`
    insert into media_assets
      (user_id, project_id, candidate_clip_id, source, media_type, status,
       name, mime_type, bytes, duration_sec, has_audio, last_used_at)
    values
      (${input.userId}, ${input.projectId}, ${input.clipId}, 'candidate',
       'video', ${status}, ${input.name}, 'video/mp4', ${input.bytes},
       ${input.duration}, true, now())
    on conflict (candidate_clip_id) do update
       set user_id = excluded.user_id,
           project_id = excluded.project_id,
           status = excluded.status,
           name = excluded.name,
           bytes = case
             when excluded.bytes > 0 then excluded.bytes
             else media_assets.bytes
           end,
           duration_sec = excluded.duration_sec,
           last_used_at = now(),
           updated_at = now()
    returning id`
  return {
    id: String(row!.id),
    name: input.name,
    mediaType: 'video',
    status,
    url: input.url,
    bytes: input.bytes,
    width: null,
    height: null,
    duration: input.duration,
    hasAudio: true,
    expiresAt: null,
    expiresSoon: false,
  }
}

export async function loadClipSegment(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<{ key: string; bytes: number; isFixture: boolean }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [segment] = await sql`
    select ms.r2_key, ms.bytes, ms.is_fixture
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
      join media_segments ms
        on ms.source_id = p.source_id
       and ms.start_sec = c.start_sec
       and ms.end_sec = c.end_sec
       and ms.expires_at > now()
     where cl.id = ${clipId}
       and p.user_id = ${userId}
     limit 1`
  if (!segment) throw new ClipNotFoundError()
  return {
    key: segment.r2_key as string,
    bytes: Number(segment.bytes),
    isFixture: Boolean(segment.is_fixture),
  }
}

export async function loadClipPreview(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<ClipPreviewStatus> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()

  const [row] = await sql`
    select cl.id,
           c.preview_status,
           c.preview_r2_key,
           segment.id as segment_id,
           segment.is_fixture as segment_is_fixture,
           job.id as job_id,
           job.status as job_status,
           job.error_code as job_error_code
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
      left join lateral (
        select ms.id
          from media_segments ms
         where ms.source_id = p.source_id
           and ms.start_sec = c.start_sec
           and ms.end_sec = c.end_sec
           and ms.expires_at > now()
         limit 1
      ) segment on true
      left join lateral (
        select j.id, j.status, j.error_code
          from jobs j
         where j.type = 'render_previews'
           and j.project_id = p.id
         order by j.created_at desc
         limit 1
      ) job on true
     where cl.id = ${clipId}
       and p.user_id = ${userId}
     limit 1`
  if (!row) throw new ClipNotFoundError()

  const prerenderReady = row.preview_status === 'ready' && Boolean(row.preview_r2_key)
  const segmentReady = Boolean(row.segment_id) && !Boolean(row.segment_is_fixture)
  const failed = Boolean(row.segment_is_fixture) || row.preview_status === 'failed' || row.job_status === 'failed' || row.job_status === 'dead'

  if (prerenderReady) {
    return {
      clipId: row.id as string,
      status: 'ready',
      url: `/api/clips/${clipId}/preview-file`,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: null,
      prerendered: true,
    }
  }
  if (segmentReady) {
    return {
      clipId: row.id as string,
      status: 'ready',
      url: `/api/clips/${clipId}/segment`,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: null,
      prerendered: false,
    }
  }
  const previewStatus = row.preview_status as 'pending' | 'rendering' | 'ready' | 'failed' | null
  return {
    clipId: row.id as string,
    status: failed ? 'failed' : previewStatus === 'rendering' ? 'rendering' : 'pending',
    url: null,
    jobId: (row.job_id as string | null) ?? null,
    errorCode: (row.job_error_code as string | null) ?? null,
    prerendered: false,
  }
}

export async function loadClipPreviewFile(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<{ key: string }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [row] = await sql`
    select c.preview_r2_key
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId}
       and p.user_id = ${userId}
       and c.preview_status = 'ready'
       and c.preview_r2_key is not null
     limit 1`
  if (!row) throw new ClipNotFoundError()
  return { key: row.preview_r2_key as string }
}

export async function createClipFromCandidate(
  sql: Sql,
  userId: string,
  candidateId: string,
): Promise<{ clipId: string; jobId: string | null }> {
  if (!UUID_RE.test(candidateId)) throw new ClipNotFoundError()

  return sql.begin(async (tx) => {
    const [candidate] = await tx`
      select c.id, c.project_id, c.start_sec, c.end_sec, p.source_id
        from clip_candidates c
        join projects p on p.id = c.project_id
       where c.id = ${candidateId} and p.user_id = ${userId}
       for update`
    if (!candidate) throw new ClipNotFoundError()

    const [existing] = await tx`
      select id from clips where candidate_id = ${candidateId} and project_id = ${candidate.project_id}
      order by created_at desc limit 1`
    const clipId = existing
      ? (existing.id as string)
      : ((
          await tx`
            insert into clips (project_id, candidate_id, edit_spec, duration_sec)
            values (${candidate.project_id}, ${candidateId},
                    ${tx.json(jsonValue(DEFAULT_EDIT_SPEC))},
                    ${Number(candidate.end_sec) - Number(candidate.start_sec)})
            returning id`
        )[0]!.id as string)

    const [segment] = await tx`
      select id from media_segments
       where source_id = ${candidate.source_id}
         and start_sec = ${candidate.start_sec}
         and end_sec = ${candidate.end_sec}
         and expires_at > now()
       limit 1`
    if (segment) return { clipId, jobId: null }

    const [activeJob] = await tx`
      select id from jobs
       where type = 'fetch_segments'
         and project_id = ${candidate.project_id}
         and status in ('queued','running')
         and payload->>'clip_id' = ${clipId}
       order by created_at desc limit 1`
    if (activeJob) return { clipId, jobId: activeJob.id as string }

    const [job] = await tx`
      insert into jobs (type, payload, user_id, project_id)
      values (
        'fetch_segments',
        ${tx.json({
          source_id: candidate.source_id as string,
          project_id: candidate.project_id as string,
          clip_id: clipId,
          ranges: [
            {
              start_sec: Number(candidate.start_sec),
              end_sec: Number(candidate.end_sec),
            },
          ],
        })},
        ${userId},
        ${candidate.project_id}
      )
      returning id`
    return { clipId, jobId: job!.id as string }
  }) as Promise<{ clipId: string; jobId: string | null }>
}

interface TranscriptBody {
  timing_precision?: unknown
  words?: Array<{ text?: unknown; start?: unknown; end?: unknown }>
}

export async function loadClipEditor(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<ClipEditorPayload> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [row] = await sql`
    select cl.id, cl.project_id, cl.candidate_id, cl.edit_spec, cl.render_status,
           c.title, c.start_sec, c.end_sec, p.source_id,
           (
             select ms.r2_key from media_segments ms
              where ms.source_id = p.source_id
                and ms.start_sec = c.start_sec
                and ms.end_sec = c.end_sec
                and ms.expires_at > now()
              limit 1
           ) as segment_key,
           (
           select ms.is_fixture from media_segments ms
            where ms.source_id = p.source_id
              and ms.start_sec = c.start_sec
              and ms.end_sec = c.end_sec
              and ms.expires_at > now()
            limit 1
           ) as segment_is_fixture,
           (
             select ms.bytes from media_segments ms
              where ms.source_id = p.source_id
                and ms.start_sec = c.start_sec
                and ms.end_sec = c.end_sec
                and ms.expires_at > now()
              limit 1
           ) as segment_bytes,
           (
             select t.r2_key from transcripts t
              where t.source_id = p.source_id
              order by t.created_at desc limit 1
           ) as transcript_key,
           (
             select j.id from jobs j
              where j.type = 'fetch_segments'
                and j.project_id = p.id
                and j.payload->>'clip_id' = cl.id::text
              order by j.created_at desc limit 1
           ) as job_id,
           (
             select j.status from jobs j
              where j.type = 'fetch_segments'
                and j.project_id = p.id
                and j.payload->>'clip_id' = cl.id::text
              order by j.created_at desc limit 1
           ) as job_status,
           (
             select j.error_code from jobs j
              where j.type = 'fetch_segments'
                and j.project_id = p.id
                and j.payload->>'clip_id' = cl.id::text
              order by j.created_at desc limit 1
           ) as job_error_code
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId} and p.user_id = ${userId}`
  if (!row) throw new ClipNotFoundError()

  const startSec = Number(row.start_sec)
  const endSec = Number(row.end_sec)
  const segmentKey = row.segment_key as string | null
  const candidateDuration = endSec - startSec
  const segmentFixture = Boolean(row.segment_is_fixture)
  const segmentUrl = segmentKey && !segmentFixture ? `/api/clips/${clipId}/segment` : null
  const candidateAsset = await upsertCandidateAsset(sql, {
    userId,
    projectId: String(row.project_id),
    clipId,
    name: String(row.title),
    duration: candidateDuration,
    ready: Boolean(segmentKey) && !segmentFixture,
    failed: segmentFixture || row.job_status === 'failed' || row.job_status === 'dead',
    bytes: Number(row.segment_bytes ?? 0),
    url: segmentUrl,
  })
  const uploadIds = [...referencedAssetIds(row.edit_spec)]
    .filter((id) => id !== candidateAsset.id)
  await touchProjectAssets(sql, userId, String(row.project_id), uploadIds)
  const uploads = await resolveProjectAssets(
    sql,
    userId,
    String(row.project_id),
    uploadIds,
  )
  const assets = [candidateAsset, ...uploads]
  let words: TranscriptWord[] = []
  let timingPrecision: 'word' | 'estimated' = 'word'
  // Selama worker masih menyiapkan segment, route dipoll tiap dua detik.
  // Transcript baru dibaca setelah media siap agar polling tidak men-download
  // JSON R2 yang sama berulang kali.
  if (row.transcript_key && segmentKey) {
    const refined = await readR2JsonIfExists<TranscriptBody>(
      `clip-transcripts/${clipId}.json`,
    )
    const transcript =
      refined ?? (await readR2Json<TranscriptBody>(row.transcript_key as string))
    timingPrecision = transcript.timing_precision === 'estimated' ? 'estimated' : 'word'
    words = (transcript.words ?? [])
      .map((word) => ({
        text: typeof word.text === 'string' ? word.text : '',
        start: Number(word.start),
        end: Number(word.end),
      }))
      .filter(
        (word) =>
          word.text &&
          Number.isFinite(word.start) &&
          Number.isFinite(word.end) &&
          (refined ? word.end > 0 && word.start < endSec - startSec : word.end > startSec) &&
          (refined || word.start < endSec),
      )
      .map((word) => ({
        ...word,
        start: Math.max(0, refined ? word.start : word.start - startSec),
        end: Math.min(endSec - startSec, refined ? word.end : word.end - startSec),
      }))
  }

  return {
    clip: {
      id: row.id as string,
      projectId: row.project_id as string,
      candidateId: row.candidate_id as string,
      title: row.title as string,
      durationSec: endSec - startSec,
      renderStatus: RENDER_STATUSES.includes(row.render_status)
        ? row.render_status
        : 'draft',
      editSpec: normalizeEditSpecV3(
        row.edit_spec,
        timelineContext(
          row.id,
          row.start_sec,
          row.end_sec,
          candidateAsset.id,
          assets,
        ),
      ),
      timingPrecision,
    },
    words,
    segment: {
      status: segmentKey && !segmentFixture
        ? 'ready'
        : segmentFixture || row.job_status === 'failed' || row.job_status === 'dead'
          ? 'failed'
          : 'pending',
      url: segmentUrl,
      isFixture: segmentFixture,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: segmentFixture ? 'SOURCE_FIXTURE' : (row.job_error_code as string | null) ?? null,
    },
    assets,
  }
}

export async function updateClip(
  sql: Sql,
  userId: string,
  clipId: string,
  input: { editSpec?: unknown; renderStatus?: unknown },
): Promise<{ editSpec: EditSpecV3; renderStatus: string }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [owned] = await sql`
    select cl.id, cl.project_id, c.title, c.start_sec, c.end_sec,
           exists (
             select 1 from media_segments ms
              where ms.source_id = p.source_id
                and ms.start_sec = c.start_sec
                and ms.end_sec = c.end_sec
                and ms.expires_at > now()
           ) as segment_ready
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId}
       and p.user_id = ${userId}`
  if (!owned) throw new ClipNotFoundError()
  const candidateDuration = Number(owned.end_sec) - Number(owned.start_sec)
  const candidateAsset = await upsertCandidateAsset(sql, {
    userId,
    projectId: String(owned.project_id),
    clipId,
    name: String(owned.title),
    duration: candidateDuration,
    ready: Boolean(owned.segment_ready),
    failed: false,
    bytes: 0,
    url: owned.segment_ready ? `/api/clips/${clipId}/segment` : null,
  })
  const uploadIds = [...referencedAssetIds(input.editSpec)]
    .filter((id) => id !== candidateAsset.id)
  const uploads = await resolveProjectAssets(
    sql,
    userId,
    String(owned.project_id),
    uploadIds,
  )
  const editSpec = normalizeEditSpecV3(
    input.editSpec,
    timelineContext(
      owned.id,
      owned.start_sec,
      owned.end_sec,
      candidateAsset.id,
      [candidateAsset, ...uploads],
    ),
  )
  await touchProjectAssets(sql, userId, String(owned.project_id), uploadIds)
  const renderStatus =
    typeof input.renderStatus === 'string' &&
    RENDER_STATUSES.includes(input.renderStatus as (typeof RENDER_STATUSES)[number])
      ? input.renderStatus
      : 'draft'
  const rows = await sql`
    update clips cl
       set edit_spec = ${sql.json(jsonValue(editSpec))},
           render_status = ${renderStatus},
           updated_at = now()
      from projects p
     where cl.id = ${clipId}
       and p.id = cl.project_id
       and p.user_id = ${userId}
    returning cl.id`
  if (rows.length === 0) throw new ClipNotFoundError()
  return { editSpec, renderStatus }
}
