import { NextResponse } from 'next/server'
import { UnsupportedUrlError } from '@cheapclipper/shared'
import { createProjectFromUrl } from '@/lib/createProject'
import { sql } from '@/lib/db'
import { messageFor } from '@/lib/errorMessages'
import { supabaseServer } from '@/lib/supabase/server'

export async function POST(req: Request) {
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
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof UnsupportedUrlError) {
      return NextResponse.json(
        { error: { code: e.code, message: messageFor(e.code) } },
        { status: 400 },
      )
    }
    console.error('gagal membuat proyek', e)
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
}
