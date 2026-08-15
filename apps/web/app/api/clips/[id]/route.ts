import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipEditor, updateClip } from '@/lib/clips'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

async function userId(): Promise<string | null> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

function missing() {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Clip tidak ditemukan.' } },
    { status: 404 },
  )
}

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/clips/[id]',
  async (_req, ctx, log) => {
  const uid = await userId()
  if (!uid) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
      { status: 401 },
    )
  }
  try {
    return NextResponse.json(await loadClipEditor(sql, uid, (await ctx.params).id))
  } catch (error) {
    if (error instanceof ClipNotFoundError) return missing()
    log.error('clip.load.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal memuat editor.' } },
      { status: 500 },
    )
  }
  },
)

export const PATCH = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/clips/[id]',
  async (req, ctx, log) => {
  const uid = await userId()
  if (!uid) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
      { status: 401 },
    )
  }
  const body = (await req.json().catch(() => ({}))) as {
    editSpec?: unknown
    renderStatus?: unknown
  }
  try {
    return NextResponse.json(await updateClip(sql, uid, (await ctx.params).id, body))
  } catch (error) {
    if (error instanceof ClipNotFoundError) return missing()
    log.error('clip.update.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal menyimpan perubahan.' } },
      { status: 500 },
    )
  }
  },
)
