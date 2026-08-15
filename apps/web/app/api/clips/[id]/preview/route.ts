import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipPreview } from '@/lib/clips'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

function missing() {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Preview klip tidak ditemukan.' } },
    { status: 404 },
  )
}

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/clips/[id]/preview',
  async (_request, ctx, log) => {
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

  try {
    return NextResponse.json(await loadClipPreview(sql, user.id, (await ctx.params).id))
  } catch (error) {
    if (error instanceof ClipNotFoundError) return missing()
    log.error('clip.preview.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal memuat preview.' } },
      { status: 500 },
    )
  }
  },
)
