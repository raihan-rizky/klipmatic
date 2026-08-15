import { NextResponse } from 'next/server'
import { deleteApiKey } from '@/lib/apiKeys'
import { sql } from '@/lib/db'
import { messageFor } from '@/lib/errorMessages'
import { errorFields, withRequestLogging } from '@/lib/observability'
import { supabaseServer } from '@/lib/supabase/server'

export const DELETE = withRequestLogging<{ params: Promise<{ id: string }> }>(
  '/api/keys/[id]',
  async (_req, ctx, log) => {
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

  const { id } = await ctx.params
  try {
    // Jawaban untuk key milik orang lain sama persis dengan key yang tidak ada,
    // sehingga tidak ada cara menebak id key user lain.
    const ok = await deleteApiKey(sql, user.id, id)
    if (!ok) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Key tidak ditemukan.' } },
        { status: 404 },
      )
    }
    return NextResponse.json({ deleted: true })
  } catch (e) {
    // Tanpa penjaga ini galat driver keluar sebagai 500 bawaan Next — bentuknya
    // bukan { error: { code, message } } yang dibaca klien, dan jejaknya memuat
    // query beserta parameter.
    log.error('api_key.delete.failed', errorFields(e))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
  },
)
