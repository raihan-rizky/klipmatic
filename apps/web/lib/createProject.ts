import type { Sql } from 'postgres'
import { normalizeSourceUrl } from '@klipmatic/shared'

export interface CreateProjectResult {
  projectId: string
  jobId: string
}

/**
 * Sumber selalu dibuat privat terlebih dahulu. Promosi menjadi publik hanya
 * dilakukan handler ingest setelah yt-dlp memastikan `availability == 'public'`.
 * Urutan ini mencegah video unlisted ikut masuk cache global.
 */
export async function createProjectFromUrl(
  sql: Sql,
  userId: string,
  rawUrl: string,
): Promise<CreateProjectResult> {
  const norm = normalizeSourceUrl(rawUrl) // melempar UnsupportedUrlError

  return sql.begin(async (tx) => {
    const [source] = await tx`
      insert into sources (kind, external_id, is_public, owner_user_id, url_original, status)
      values (${norm.kind}, ${norm.externalId}, false, ${userId}, ${norm.urlOriginal}, 'pending')
      on conflict (kind, external_id, owner_user_id) where not is_public
      do update set updated_at = now()
      returning id
    `
    const sourceId = source!.id as string

    const [project] = await tx`
      insert into projects (user_id, source_id, title)
      values (${userId}, ${sourceId}, ${norm.urlOriginal})
      returning id
    `
    const projectId = project!.id as string

    // tx.json() menyerahkan serialisasi ke postgres.js. Meng-JSON.stringify
    // sendiri lalu meng-cast ::jsonb menghasilkan encoding ganda: yang
    // tersimpan adalah string scalar JSON, bukan objek, sehingga worker
    // Python menerima str dan payload["source_id"] gagal.
    const [job] = await tx`
      insert into jobs (type, payload, user_id, project_id)
      values ('ingest',
              ${tx.json({ source_id: sourceId, project_id: projectId })},
              ${userId}, ${projectId})
      returning id
    `
    return { projectId, jobId: job!.id as string }
  }) as Promise<CreateProjectResult>
}
