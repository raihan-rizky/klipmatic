import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { currentAppUser } from '@/lib/auth/currentUser'

const PIPELINE_TYPES = ['ingest', 'transcribe', 'analyze', 'prepare_thumbnails'] as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const user = await currentAppUser()

  const rows = await sql`
    select j.id, j.type, j.status, j.progress, j.error_code
      from jobs j
      join projects p on p.id = j.project_id
     where j.project_id = ${projectId}
       and p.user_id = ${user.id}
       and j.type = any(${sql.array([...PIPELINE_TYPES])}::text[])
     order by j.created_at desc
     limit 1
  `
  return NextResponse.json({ job: rows[0] ?? null })
}
