import { NextResponse } from 'next/server'
import { deleteApiKey } from '@/lib/apiKeys'
import { sql } from '@/lib/db'
import { describeError } from '@/lib/errorLog'
import { messageFor } from '@/lib/errorMessages'
import { supabaseServer } from '@/lib/supabase/server'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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
    console.error('gagal menghapus API key untuk user', user.id, describeError(e))
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: messageFor('INTERNAL') } },
      { status: 500 },
    )
  }
}
