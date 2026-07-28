import Link from 'next/link'
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react'
import { signOut } from '@/app/auth/actions'
import { ImplicitMagicLinkForm } from '@/components/ImplicitMagicLinkForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { supabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const STATUS_MESSAGE = {
  'invalid-email': 'Masukkan alamat email yang valid.',
  'send-failed': 'Magic link gagal dikirim. Coba lagi beberapa saat.',
  'callback-failed':
    'Link lama gagal membuat session. Minta link baru untuk memakai login lintas browser.',
  sent: 'Magic link sudah dikirim. Cek inbox dan folder spam kamu.',
} as const

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="border-b border-border/70 pb-7">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
            Akun
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-[-0.045em]">
            Workspace kamu siap
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Session aktif dan semua project tetap terhubung ke akun ini.
          </p>
        </div>
        <Card className="mt-8">
          <CardContent className="flex flex-col gap-6 pt-5 sm:flex-row sm:items-center sm:pt-6">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="size-7" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">Masuk sebagai</p>
              <p className="mt-1 truncate font-bold">{user.email ?? 'user aktif'}</p>
              <Badge className="mt-3">Session aktif</Badge>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button asChild>
                <Link href="/">
                  Buat klip baru
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <form action={signOut}>
                <Button type="submit" variant="ghost" className="w-full">
                  <LogOut className="size-4" aria-hidden="true" />
                  Keluar
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </section>
    )
  }

  const message =
    status && status in STATUS_MESSAGE
      ? STATUS_MESSAGE[status as keyof typeof STATUS_MESSAGE]
      : null

  return (
    <section className="mx-auto grid min-h-[calc(100vh-12rem)] max-w-5xl items-center gap-10 py-4 lg:grid-cols-[1fr_440px]">
      <div className="max-w-xl">
        <Badge>Workspace aman</Badge>
        <h1 className="mt-6 text-4xl font-black tracking-[-0.055em] sm:text-5xl">
          Masuk sekali, lanjut bikin klip.
        </h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Nggak perlu mengingat password. Magic link boleh dibuka dari browser mana pun
          dan session akan disimpan dengan aman.
        </p>
        <div className="mt-8 hidden items-center gap-3 text-sm text-muted lg:flex">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          API key dan project hanya bisa diakses oleh akunmu.
        </div>
      </div>

      <Card className="border-primary/15 bg-surface-raised/95">
        <CardHeader>
          <CardTitle className="text-2xl">Masuk tanpa password</CardTitle>
          <p className="text-sm leading-6 text-muted">
            Cek inbox setelah mengirim. Link hanya berlaku untuk waktu terbatas.
          </p>
        </CardHeader>
        <CardContent>
          <ImplicitMagicLinkForm initialMessage={message} />
        </CardContent>
      </Card>
    </section>
  )
}
