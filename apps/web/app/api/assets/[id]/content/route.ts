import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { loadAssetObject, MediaAssetError } from '@/lib/mediaAssets'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { signedR2Get } from '@/lib/r2'
import { supabaseServer } from '@/lib/supabase/server'

const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
  ASSET_READ_ONLY: 409,
} as const

export const GET = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/assets/[id]/content',
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
    const object = await loadAssetObject(sql, user.id, (await ctx.params).id)
    if (object.status !== 'ready') {
      throw new MediaAssetError('ASSET_NOT_READY', 'Media masih diproses.')
    }
    const upstream = await fetch(await signedR2Get(object.key), { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      throw new Error(`R2 mengembalikan status ${upstream.status}`)
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'cache-control': 'private, max-age=3600',
        'content-length': String(object.bytes),
        'content-type': object.mimeType,
      },
    })
  } catch (error) {
    if (error instanceof MediaAssetError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: STATUS_BY_CODE[error.code] },
      )
    }
    log.error('asset.content.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'STORAGE_ERROR', message: 'Media gagal dimuat.' } },
      { status: 502 },
    )
  }
  },
)
