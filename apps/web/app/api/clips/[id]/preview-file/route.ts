import { NextResponse } from 'next/server'
import { ClipNotFoundError, loadClipPreviewFile } from '@/lib/clips'
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
  '/api/clips/[id]/preview-file',
  async (request, ctx, log) => {
    const uid = await userId()
    if (!uid) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
        { status: 401 },
      )
    }

    try {
      const preview = await loadClipPreviewFile(sql, uid, (await ctx.params).id)
      // Header Range diteruskan supaya <video> bisa seek dan mulai memutar
      // sebelum seluruh file terunduh; tanpa ini preview terasa lambat.
      const upstreamHeaders = new Headers({ 'cache-control': 'no-store' })
      const range = request.headers.get('range')
      if (range) upstreamHeaders.set('range', range)
      const upstream = await fetch(await signedR2Get(preview.key), {
        headers: upstreamHeaders,
        cache: 'no-store',
      })
      if (!upstream.ok && upstream.status !== 206) {
        throw new Error(`R2 mengembalikan status ${upstream.status}`)
      }
      if (!upstream.body) {
        throw new Error('R2 tidak mengembalikan body')
      }
      const headers: Record<string, string> = {
        'cache-control': 'private, max-age=3600',
        'content-type': upstream.headers.get('content-type') ?? 'video/mp4',
        'accept-ranges': 'bytes',
      }
      const contentLength = upstream.headers.get('content-length')
      if (contentLength) headers['content-length'] = contentLength
      const contentRange = upstream.headers.get('content-range')
      if (contentRange) headers['content-range'] = contentRange
      return new NextResponse(upstream.body, { status: upstream.status, headers })
    } catch (error) {
      if (error instanceof ClipNotFoundError) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Preview klip tidak ditemukan.' } },
          { status: 404 },
        )
      }
      log.error('clip.preview_file.failed', errorFields(error))
      return NextResponse.json(
        { error: { code: 'STORAGE_ERROR', message: 'Preview klip gagal dimuat.' } },
        { status: 502 },
      )
    }
  },
)
