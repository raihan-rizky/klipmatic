import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { deleteProjectUpload, MediaAssetError } from '@/lib/mediaAssets'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { currentAppUser } from '@/lib/auth/currentUser'

const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
  ASSET_READ_ONLY: 409,
} as const

export const DELETE = withRequestLogging<{
  params: Promise<{ id: string; assetId: string }>
}>('/api/projects/[id]/assets/[assetId]', async (_request, ctx, log) => {
  const user = await currentAppUser()
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
    log.error('asset.delete.failed', errorFields(error))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Media gagal dihapus.' } },
      { status: 500 },
    )
  }
})
