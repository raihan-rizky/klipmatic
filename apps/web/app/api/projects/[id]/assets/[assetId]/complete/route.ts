import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { finalizeMediaUpload, MediaAssetError } from '@/lib/mediaAssets'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
  ASSET_READ_ONLY: 409,
} as const

export const POST = withRequestLogging<{
  params: Promise<{ id: string; assetId: string }>
}>('/api/projects/[id]/assets/[assetId]/complete', async (_request, ctx, log) => {
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
  const { id, assetId } = await ctx.params
  try {
    return NextResponse.json(
      await finalizeMediaUpload(sql, user.id, id, assetId),
    )
  } catch (error) {
    if (error instanceof MediaAssetError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: STATUS_BY_CODE[error.code] },
      )
    }
    log.error('asset.complete.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Upload gagal diselesaikan.' } },
      { status: 500 },
    )
  }
})
