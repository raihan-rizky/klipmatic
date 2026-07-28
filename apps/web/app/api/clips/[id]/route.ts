import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipEditor, updateClip } from '@/lib/clips'
import { sql } from '@/lib/db'
import { describeError } from '@/lib/errorLog'
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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    console.error('gagal memuat clip', describeError(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal memuat editor.' } },
      { status: 500 },
    )
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    console.error('gagal menyimpan clip', describeError(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Gagal menyimpan perubahan.' } },
      { status: 500 },
    )
  }
}
