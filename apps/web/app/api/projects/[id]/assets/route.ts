import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { describeError } from '@/lib/errorLog'
import {
  createMediaUpload,
  listProjectUploads,
  MediaAssetError,
  type CreateMediaUploadInput,
} from '@/lib/mediaAssets'
import { supabaseServer } from '@/lib/supabase/server'

const STATUS_BY_CODE = {
  ASSET_INVALID: 400,
  ASSET_TOO_LARGE: 413,
  ASSET_QUOTA_EXCEEDED: 413,
  ASSET_NOT_FOUND: 404,
  ASSET_NOT_READY: 409,
  ASSET_READ_ONLY: 409,
} as const

async function userId(): Promise<string | null> {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

function unauthorized() {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Silakan masuk dulu.' } },
    { status: 401 },
  )
}

function failure(error: unknown, action: string) {
  if (error instanceof MediaAssetError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: STATUS_BY_CODE[error.code] },
    )
  }
  console.error(`gagal ${action} media project`, describeError(error))
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Media project gagal diproses.' } },
    { status: 500 },
  )
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await userId()
  if (!uid) return unauthorized()
  try {
    return NextResponse.json(
      await listProjectUploads(sql, uid, (await ctx.params).id),
    )
  } catch (error) {
    return failure(error, 'memuat')
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await userId()
  if (!uid) return unauthorized()
  const input = (await request.json().catch(() => ({}))) as CreateMediaUploadInput
  try {
    return NextResponse.json(
      await createMediaUpload(sql, uid, (await ctx.params).id, input),
      { status: 201 },
    )
  } catch (error) {
    return failure(error, 'membuat')
  }
}
