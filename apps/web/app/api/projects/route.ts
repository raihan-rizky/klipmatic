import { NextResponse } from 'next/server'
import { UnsupportedUrlError } from '@klipmatic/shared'
import { createProjectFromUrl } from '@/lib/createProject'
import { sql } from '@/lib/db'
import { messageFor } from '@/lib/errorMessages'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { currentAppUser } from '@/lib/auth/currentUser'

export const POST = withRequestLogging('/api/projects', async (req, _ctx, log) => {
  const user = await currentAppUser()

  let url: unknown
  try {
    ;({ url } = await req.json())
  } catch {
    url = null
  }
  if (typeof url !== 'string' || !url.trim()) {
    return NextResponse.json(
      { error: { code: 'SOURCE_UNSUPPORTED', message: messageFor('SOURCE_UNSUPPORTED') } },
      { status: 400 },
    )
  }

  try {
    // Auth tetap berasal dari Supabase, sedangkan data aplikasi berada di
    // PostgreSQL lokal. Pastikan user Auth memiliki profil lokal sebelum
    // membuat source/project yang memiliki foreign key ke profiles.user_id.
    await sql`
      insert into profiles (user_id)
      values (${user.id})
      on conflict (user_id) do nothing
    `
    const result = await createProjectFromUrl(sql, user.id, url)
    log.info('project.created', {
      project_id: result.projectId,
      job_id: result.jobId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof UnsupportedUrlError) {
      return NextResponse.json(
        { error: { code: e.code, message: messageFor(e.code) } },
        { status: 400 },
      )
    }
    log.error('project.create.failed', errorFields(e))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
})
