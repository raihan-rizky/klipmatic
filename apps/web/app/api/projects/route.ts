import { NextResponse } from 'next/server'
import { UnsupportedUrlError } from '@klipmatic/shared'
import { createProjectFromUrl } from '@/lib/createProject'
import { sql } from '@/lib/db'
import { messageFor } from '@/lib/errorMessages'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

export const POST = withRequestLogging('/api/projects', async (req, _ctx, log) => {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
      { status: 401 },
    )
  }

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
