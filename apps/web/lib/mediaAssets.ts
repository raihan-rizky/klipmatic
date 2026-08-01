import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import {
  ALLOWED_MEDIA_MIME,
  MEDIA_LIMITS,
  PROJECT_MEDIA_QUOTA_BYTES,
  type MediaType,
} from './mediaAssetConfig'
import {
  getBuiltInAsset,
  type BuiltInMediaAsset,
} from './builtinMedia'
import { deleteR2Object, headR2Object, signedR2Put } from './r2'

export {
  ALLOWED_MEDIA_MIME,
  MEDIA_LIMITS,
  PROJECT_MEDIA_QUOTA_BYTES,
} from './mediaAssetConfig'
export type { MediaType } from './mediaAssetConfig'
export type MediaAssetStatus = 'uploading' | 'ready' | 'failed' | 'expired'

export const UPLOAD_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
export const INCOMPLETE_UPLOAD_RETENTION_MS = 60 * 60 * 1000

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export type MediaAssetErrorCode =
  | 'ASSET_INVALID'
  | 'ASSET_TOO_LARGE'
  | 'ASSET_QUOTA_EXCEEDED'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_NOT_READY'
  | 'ASSET_READ_ONLY'

export class MediaAssetError extends Error {
  constructor(
    public readonly code: MediaAssetErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MediaAssetError'
  }
}

export interface MediaAssetDto {
  id: string
  name: string
  mediaType: MediaType
  status: MediaAssetStatus
  url: string | null
  bytes: number
  width: number | null
  height: number | null
  duration: number | null
  hasAudio: boolean
  expiresAt: string | null
  expiresSoon: boolean
}

export interface MediaAssetStorage {
  signedPut(key: string, contentType: string): Promise<string>
  head(key: string): Promise<{ bytes: number; contentType: string | null }>
  delete(key: string): Promise<void>
}

const defaultStorage: MediaAssetStorage = {
  signedPut: signedR2Put,
  head: headR2Object,
  delete: deleteR2Object,
}

export interface CreateMediaUploadInput {
  name: string
  mediaType: MediaType
  mimeType: string
  bytes: number
}

export interface CreateMediaUploadResult {
  asset: MediaAssetDto
  upload: {
    url: string
    method: 'PUT'
    headers: { 'content-type': string }
  }
}

interface MediaAssetRow {
  id: unknown
  name: unknown
  media_type: unknown
  status: unknown
  bytes: unknown
  width: unknown
  height: unknown
  duration_sec: unknown
  has_audio: unknown
  expires_at: unknown
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function rowToDto(row: MediaAssetRow, now = new Date()): MediaAssetDto {
  const id = String(row.id)
  const status = row.status as MediaAssetStatus
  const expiresAt = asDate(row.expires_at)
  return {
    id,
    name: String(row.name),
    mediaType: row.media_type as MediaType,
    status,
    url: status === 'ready' ? `/api/assets/${id}/content` : null,
    bytes: Number(row.bytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    duration: row.duration_sec == null ? null : Number(row.duration_sec),
    hasAudio: Boolean(row.has_audio),
    expiresAt: expiresAt?.toISOString() ?? null,
    expiresSoon:
      status === 'ready' &&
      expiresAt !== null &&
      expiresAt.getTime() > now.getTime() &&
      expiresAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000,
  }
}

function validateCreateInput(input: CreateMediaUploadInput): void {
  if (
    !input.name.trim() ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes <= 0 ||
    !Object.hasOwn(MEDIA_LIMITS, input.mediaType) ||
    !ALLOWED_MEDIA_MIME[input.mediaType].includes(input.mimeType as never)
  ) {
    throw new MediaAssetError('ASSET_INVALID', 'File media tidak valid.')
  }
  if (input.bytes > MEDIA_LIMITS[input.mediaType]) {
    throw new MediaAssetError('ASSET_TOO_LARGE', 'Ukuran file melewati batas tipe media.')
  }
}

export function referencedAssetIds(
  value: unknown,
  output = new Set<string>(),
): Set<string> {
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const item of value) referencedAssetIds(item, output)
    return output
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'assetId' && typeof item === 'string') output.add(item)
    else referencedAssetIds(item, output)
  }
  return output
}

export async function resolveProjectAssets(
  sql: Sql,
  userId: string,
  projectId: string,
  assetIds: string[],
): Promise<MediaAssetDto[]> {
  const builtIns = assetIds
    .map((id) => getBuiltInAsset(id))
    .filter((asset): asset is BuiltInMediaAsset => asset !== undefined)
  if (builtIns.length > 0) {
    const [project] = await sql`
      select id from projects where id = ${projectId} and user_id = ${userId}`
    if (!project) return []
  }
  const safeAssetIds = assetIds.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  )
  const rows = safeAssetIds.length > 0
    ? await sql`
        select ma.id, ma.name, ma.media_type, ma.status, ma.bytes, ma.width,
               ma.height, ma.duration_sec, ma.has_audio, ma.expires_at
          from media_assets ma
          join projects p on p.id = ma.project_id
         where ma.user_id = ${userId}
           and ma.project_id = ${projectId}
           and p.user_id = ${userId}
           and ma.source = 'upload'
           and ma.id = any(${safeAssetIds}::uuid[])
         order by ma.created_at`
    : []
  const resolvedById = new Map<string, MediaAssetDto>([
    ...builtIns.map((asset) => [asset.id, resolvedBuiltInAsset(asset)] as const),
    ...rows.map((row) => {
      const asset = rowToDto(row as MediaAssetRow)
      return [asset.id, asset] as const
    }),
  ])
  const seen = new Set<string>()
  return assetIds.flatMap((id) => {
    const asset = resolvedById.get(id)
    if (!asset || seen.has(id)) return []
    seen.add(id)
    return [asset]
  })
}

export function resolvedBuiltInAsset(
  asset: BuiltInMediaAsset,
): BuiltInMediaAsset {
  return {
    ...asset,
    status: 'ready',
    expiresAt: null,
    expiresSoon: false,
  }
}

export async function touchProjectAssets(
  sql: Sql,
  userId: string,
  projectId: string,
  assetIds: string[],
): Promise<void> {
  const safeAssetIds = assetIds.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  )
  if (safeAssetIds.length === 0) return
  await sql`
    update media_assets ma
       set last_used_at = now(),
           expires_at = now() + interval '3 days',
           updated_at = now()
      from projects p
     where ma.user_id = ${userId}
       and ma.project_id = ${projectId}
       and p.id = ma.project_id
       and p.user_id = ${userId}
       and ma.id = any(${safeAssetIds}::uuid[])
       and ma.source = 'upload'
       and ma.status = 'ready'`
}

export async function createMediaUpload(
  sql: Sql,
  userId: string,
  projectId: string,
  input: CreateMediaUploadInput,
  storage: MediaAssetStorage = defaultStorage,
): Promise<CreateMediaUploadResult> {
  validateCreateInput(input)
  const assetId = randomUUID()
  const extension = EXTENSION_BY_MIME[input.mimeType]
  if (!extension) throw new MediaAssetError('ASSET_INVALID', 'Tipe file tidak didukung.')
  const storageKey = `uploads/${userId}/${projectId}/${assetId}/source.${extension}`
  const expiresAt = new Date(Date.now() + INCOMPLETE_UPLOAD_RETENTION_MS)

  const asset = (await sql.begin(async (tx) => {
    const [project] = await tx`
      select id from projects
       where id = ${projectId} and user_id = ${userId}
       for update`
    if (!project) {
      throw new MediaAssetError('ASSET_NOT_FOUND', 'Project tidak ditemukan.')
    }
    const [usage] = await tx`
      select coalesce(sum(bytes), 0)::bigint as used_bytes
        from media_assets
       where project_id = ${projectId}
         and user_id = ${userId}
         and source = 'upload'
         and status in ('uploading', 'ready')`
    if (Number(usage!.used_bytes) + input.bytes > PROJECT_MEDIA_QUOTA_BYTES) {
      throw new MediaAssetError(
        'ASSET_QUOTA_EXCEEDED',
        'Total media project melewati kuota 300 MB.',
      )
    }
    const [row] = await tx`
      insert into media_assets
        (id, user_id, project_id, source, media_type, status, name, storage_key,
         mime_type, bytes, expires_at)
      values
        (${assetId}, ${userId}, ${projectId}, 'upload', ${input.mediaType},
         'uploading', ${input.name.trim()}, ${storageKey}, ${input.mimeType},
         ${input.bytes}, ${expiresAt})
      returning id, name, media_type, status, bytes, width, height, duration_sec,
                has_audio, expires_at`
    return rowToDto(row as MediaAssetRow)
  })) as MediaAssetDto

  try {
    const url = await storage.signedPut(storageKey, input.mimeType)
    return {
      asset,
      upload: {
        url,
        method: 'PUT',
        headers: { 'content-type': input.mimeType },
      },
    }
  } catch (error) {
    await sql`
      update media_assets
         set status = 'failed', updated_at = now()
       where id = ${assetId} and user_id = ${userId}`
    throw error
  }
}

export async function finalizeMediaUpload(
  sql: Sql,
  userId: string,
  projectId: string,
  assetId: string,
  storage: MediaAssetStorage = defaultStorage,
): Promise<{ assetId: string; jobId: string }> {
  if (assetId.startsWith('builtin:')) {
    throw new MediaAssetError('ASSET_READ_ONLY', 'Media bawaan hanya dapat dibaca.')
  }
  const [asset] = await sql`
    select ma.id, ma.storage_key, ma.mime_type, ma.bytes
      from media_assets ma
      join projects p on p.id = ma.project_id
     where ma.id = ${assetId}
       and ma.project_id = ${projectId}
       and ma.user_id = ${userId}
       and p.user_id = ${userId}
       and ma.source = 'upload'
       and ma.status = 'uploading'`
  if (!asset) throw new MediaAssetError('ASSET_NOT_FOUND', 'Upload tidak ditemukan.')

  const object = await storage.head(String(asset.storage_key))
  if (
    object.bytes !== Number(asset.bytes) ||
    object.contentType?.split(';', 1)[0]?.trim().toLowerCase() !==
      String(asset.mime_type).toLowerCase()
  ) {
    throw new MediaAssetError('ASSET_INVALID', 'Metadata upload tidak cocok.')
  }

  return (await sql.begin(async (tx) => {
    const [locked] = await tx`
      select ma.id
        from media_assets ma
        join projects p on p.id = ma.project_id
       where ma.id = ${assetId}
         and ma.project_id = ${projectId}
         and ma.user_id = ${userId}
         and p.user_id = ${userId}
         and ma.status = 'uploading'
       for update`
    if (!locked) throw new MediaAssetError('ASSET_NOT_FOUND', 'Upload tidak ditemukan.')
    const [active] = await tx`
      select id from jobs
       where type = 'probe_asset'
         and project_id = ${projectId}
         and payload->>'asset_id' = ${assetId}
         and status in ('queued', 'running')
       order by created_at desc limit 1`
    if (active) return { assetId, jobId: String(active.id) }

    await tx`
      update media_assets
         set expires_at = ${new Date(Date.now() + UPLOAD_RETENTION_MS)},
             last_used_at = now(), updated_at = now()
       where id = ${assetId}`
    const [job] = await tx`
      insert into jobs (type, payload, user_id, project_id)
      values ('probe_asset', ${tx.json({ asset_id: assetId })}, ${userId}, ${projectId})
      returning id`
    return { assetId, jobId: String(job!.id) }
  })) as { assetId: string; jobId: string }
}

export async function listProjectUploads(
  sql: Sql,
  userId: string,
  projectId: string,
): Promise<{
  assets: MediaAssetDto[]
  usage: { usedBytes: number; limitBytes: number }
}> {
  const [project] = await sql`
    select id from projects where id = ${projectId} and user_id = ${userId}`
  if (!project) throw new MediaAssetError('ASSET_NOT_FOUND', 'Project tidak ditemukan.')
  const rows = await sql`
    select id, name, media_type, status, bytes, width, height, duration_sec,
           has_audio, expires_at
      from media_assets
     where project_id = ${projectId}
       and user_id = ${userId}
       and source = 'upload'
     order by created_at desc`
  const usedBytes = rows
    .filter((row) => row.status === 'uploading' || row.status === 'ready')
    .reduce((total, row) => total + Number(row.bytes), 0)
  return {
    assets: rows.map((row) => rowToDto(row as MediaAssetRow)),
    usage: { usedBytes, limitBytes: PROJECT_MEDIA_QUOTA_BYTES },
  }
}

export async function loadAssetObject(
  sql: Sql,
  userId: string,
  assetId: string,
): Promise<{ key: string; mimeType: string; bytes: number; status: MediaAssetStatus }> {
  const [asset] = await sql`
    select storage_key, mime_type, bytes, status
      from media_assets
     where id = ${assetId}
       and user_id = ${userId}
       and source = 'upload'
       and status <> 'expired'`
  if (!asset) throw new MediaAssetError('ASSET_NOT_FOUND', 'Media tidak ditemukan.')
  return {
    key: String(asset.storage_key),
    mimeType: String(asset.mime_type),
    bytes: Number(asset.bytes),
    status: asset.status as MediaAssetStatus,
  }
}

export async function deleteProjectUpload(
  sql: Sql,
  userId: string,
  projectId: string,
  assetId: string,
  storage: MediaAssetStorage = defaultStorage,
): Promise<void> {
  if (assetId.startsWith('builtin:')) {
    throw new MediaAssetError('ASSET_READ_ONLY', 'Media bawaan hanya dapat dibaca.')
  }
  const [asset] = await sql`
    select ma.storage_key
      from media_assets ma
      join projects p on p.id = ma.project_id
     where ma.id = ${assetId}
       and ma.project_id = ${projectId}
       and ma.user_id = ${userId}
       and p.user_id = ${userId}
       and ma.source = 'upload'
       and ma.status <> 'expired'`
  if (!asset) throw new MediaAssetError('ASSET_NOT_FOUND', 'Media tidak ditemukan.')
  await storage.delete(String(asset.storage_key))
  await sql`
    update media_assets
       set status = 'expired', expires_at = now(), updated_at = now()
     where id = ${assetId} and user_id = ${userId} and project_id = ${projectId}`
}

export async function resolveClipAssets(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<MediaAssetDto[]> {
  const [clip] = await sql`
    select cl.edit_spec, cl.project_id
      from clips cl
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId} and p.user_id = ${userId}`
  if (!clip) throw new MediaAssetError('ASSET_NOT_FOUND', 'Clip tidak ditemukan.')
  const assetIds = [...referencedAssetIds(clip.edit_spec)]
  if (assetIds.length === 0) return []
  return resolveProjectAssets(sql, userId, String(clip.project_id), assetIds)
}

export async function touchClipAssets(
  sql: Sql,
  userId: string,
  clipId: string,
): Promise<void> {
  const [clip] = await sql`
    select cl.edit_spec, cl.project_id
      from clips cl
      join projects p on p.id = cl.project_id
     where cl.id = ${clipId} and p.user_id = ${userId}`
  if (!clip) throw new MediaAssetError('ASSET_NOT_FOUND', 'Clip tidak ditemukan.')
  const assetIds = [...referencedAssetIds(clip.edit_spec)]
  await touchProjectAssets(sql, userId, String(clip.project_id), assetIds)
}
