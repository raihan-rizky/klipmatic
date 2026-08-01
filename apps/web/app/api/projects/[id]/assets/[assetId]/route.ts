import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { describeError } from '@/lib/errorLog'
import { deleteProjectUpload, MediaAssetError } from '@/lib/mediaAssets'
import { supabaseServer } from '@/lib/supabase/server'

const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
} as const

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
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
    await deleteProjectUpload(sql, user.id, id, assetId)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof MediaAssetError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: STATUS_BY_CODE[error.code] },
      )
    }
    console.error('gagal menghapus media project', describeError(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Media gagal dihapus.' } },
      { status: 500 },
    )
  }
}
