import { NextResponse } from 'next/server'
import { CandidateNotFoundError, loadCandidateThumbnail } from '@/lib/candidates'
import { sql } from '@/lib/db'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { signedR2Get } from '@/lib/r2'
import { supabaseServer } from '@/lib/supabase/server'

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/candidates/[id]/thumbnail',
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
    const thumbnail = await loadCandidateThumbnail(sql, user.id, (await ctx.params).id)
    const upstream = await fetch(await signedR2Get(thumbnail.key), { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      throw new Error(`R2 mengembalikan status ${upstream.status}`)
    }

    const headers: Record<string, string> = {
      'cache-control': 'private, max-age=3600',
      'content-type': upstream.headers.get('content-type') ?? 'image/webp',
    }
    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers['content-length'] = contentLength

    return new NextResponse(upstream.body, { status: 200, headers })
  } catch (error) {
    if (error instanceof CandidateNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Thumbnail kandidat tidak ditemukan.' } },
        { status: 404 },
      )
    }
    log.error('candidate.thumbnail.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'STORAGE_ERROR', message: 'Thumbnail gagal dimuat.' } },
      { status: 502 },
    )
  }
  },
)
