import type { Sql } from 'postgres'
import {
  DEFAULT_EDIT_SPEC,
  normalizeEditSpecV2,
  type EditSpecV2,
  type TimelineContext,
  type TranscriptWord,
} from '@cheapclipper/engine'
import type { ClipEditorPayload } from './clipTypes'
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
): TimelineContext {
  return {
    sourceId: String(id),
    candidateDuration: Number(endSec) - Number(startSec),
  }
}

export async function loadClipSegment(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<{ key: string; bytes: number }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [segment] = await sql`
    select ms.r2_key, ms.bytes
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
  }
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
      editSpec: normalizeEditSpecV2(
        row.edit_spec,
        timelineContext(row.id, row.start_sec, row.end_sec),
      ),
      timingPrecision,
    },
    words,
    segment: {
      status: segmentKey
        ? 'ready'
        : row.job_status === 'failed' || row.job_status === 'dead'
          ? 'failed'
          : 'pending',
      url: segmentKey ? `/api/clips/${clipId}/segment` : null,
      jobId: (row.job_id as string | null) ?? null,
      errorCode: (row.job_error_code as string | null) ?? null,
    },
  }
}

export async function updateClip(
  sql: Sql,
  userId: string,
  clipId: string,
  input: { editSpec?: unknown; renderStatus?: unknown },
): Promise<{ editSpec: EditSpecV2; renderStatus: string }> {
  if (!UUID_RE.test(clipId)) throw new ClipNotFoundError()
  const [owned] = await sql`
    select cl.id, c.start_sec, c.end_sec
      from clips cl
      join clip_candidates c on c.id = cl.candidate_id
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId}
       and p.user_id = ${userId}`
  if (!owned) throw new ClipNotFoundError()
  const editSpec = normalizeEditSpecV2(
    input.editSpec,
    timelineContext(owned.id, owned.start_sec, owned.end_sec),
  )
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
