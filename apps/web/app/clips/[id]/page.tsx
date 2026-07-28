import Link from 'next/link'
import { LogIn } from 'lucide-react'
import { ClipEditor } from '@/components/ClipEditor'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { supabaseServer } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function ClipPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return (
      <section className="grid min-h-[calc(100vh-12rem)] place-items-center">
        <StatePanel
          title="Masuk untuk membuka editor"
          description="Edit spec dan segmen video hanya tersedia untuk pemilik klip."
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
  return <ClipEditor clipId={(await params).id} />
}
