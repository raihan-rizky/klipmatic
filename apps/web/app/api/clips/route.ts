import { NextResponse } from 'next/server'
import { ClipNotFoundError, createClipFromCandidate } from '@/lib/clips'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

export const POST = withRequestLogging('/api/clips', async (req, _ctx, log) => {
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
  const body = (await req.json().catch(() => null)) as { candidateId?: unknown } | null
  try {
    const result = await createClipFromCandidate(
      sql,
      user.id,
      typeof body?.candidateId === 'string' ? body.candidateId : '',
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ClipNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Kandidat tidak ditemukan.' } },
        { status: 404 },
      )
    }
    log.error('clip.create.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal membuat clip.' } },
      { status: 500 },
    )
  }
})
