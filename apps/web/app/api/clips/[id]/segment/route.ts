import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipSegment } from '@/lib/clips'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { signedR2Get } from '@/lib/r2'
import { supabaseServer } from '@/lib/supabase/server'

async function userId(): Promise<string | null> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/clips/[id]/segment',
  async (_request, ctx, log) => {
  const uid = await userId()
  if (!uid) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
      { status: 401 },
    )
  }

  try {
    const segment = await loadClipSegment(sql, uid, (await ctx.params).id)
    const upstream = await fetch(await signedR2Get(segment.key), {
      cache: 'no-store',
    })
    if (!upstream.ok || !upstream.body) {
      throw new Error(`R2 mengembalikan status ${upstream.status}`)
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-length': String(segment.bytes),
        'content-type': upstream.headers.get('content-type') ?? 'video/mp4',
      },
    })
  } catch (error) {
    if (error instanceof ClipNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Potongan video tidak ditemukan.' } },
        { status: 404 },
      )
    }
    log.error('clip.segment.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'STORAGE_ERROR', message: 'Potongan video gagal dimuat.' } },
      { status: 502 },
    )
  }
  },
)
