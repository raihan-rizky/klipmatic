import Link from 'next/link'
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react'
import { ApiKeyForm } from '@/components/ApiKeyForm'
import { PageHeader } from '@/components/PageHeader'
import { StatePanel } from '@/components/StatePanel'
import { ApiKeyCard } from '@/components/settings/ApiKeyCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { listApiKeys } from '@/lib/apiKeys'
import { sql } from '@/lib/db'
import { supabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function KeysPage() {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return (
      <section className="grid min-h-[calc(100vh-12rem)] place-items-center">
        <StatePanel
          title="Masuk untuk mengatur API key"
          description="Credential hanya dapat diakses dan diubah oleh pemilik akun."
          action={
            <Button asChild>
              <Link href="/login">
                <LogIn className="size-4" aria-hidden="true" />
                Buka halaman akun
              </Link>
            </Button>
          }
        />
      </section>
    )
  }

  const keys = await listApiKeys(sql, user.id)

  return (
    <section className="space-y-10">
      <PageHeader
        eyebrow="Settings"
        title="API Key"
        description="Hubungkan provider AI pilihanmu. Biaya model tetap transparan dan kamu yang menentukan."
        actions={
          <Badge>
            <ShieldCheck className="mr-1 size-3" aria-hidden="true" />
            Enkripsi aktif
          </Badge>
        }
      />

      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black tracking-[-0.03em]">Key tersimpan</h2>
            <p className="mt-1 text-sm text-muted">Secret tidak pernah ditampilkan kembali.</p>
          </div>
          <Badge variant="muted">{keys.length} key</Badge>
        </div>
        {keys.length === 0 ? (
          <StatePanel
            title="Belum ada API key"
            description="Tambahkan satu provider agar CheapClipper bisa mencari highlight video."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {keys.map((apiKey) => <ApiKeyCard key={apiKey.id} apiKey={apiKey} />)}
          </div>
        )}
      </div>

      <div>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-xl font-black tracking-[-0.03em]">Tambah key</h2>
            <p className="mt-1 text-sm text-muted">Pilih preset atau masukkan provider kompatibel.</p>
          </div>
        </div>
        <ApiKeyForm />
      </div>
    </section>
  )
}
