import Link from 'next/link'
import { ArrowLeft, LogIn } from 'lucide-react'
import { CandidateList } from '@/components/CandidateList'
import { JobProgress } from '@/components/JobProgress'
import { PageHeader } from '@/components/PageHeader'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { latestThumbnailJobStatus, listCandidates, projectViewState } from '@/lib/candidates'
import { sql } from '@/lib/db'
import { supabaseServer } from '@/lib/supabase/server'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ job?: string }>
}) {
  const { id } = await params
  const { job } = await searchParams

  const supabase = await supabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return (
      <section className="grid min-h-[calc(100vh-12rem)] place-items-center">
        <StatePanel
          title="Masuk untuk melihat project"
          description="Silakan masuk dulu. Kandidat dan progress analisis hanya tersedia untuk pemilik project."
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

  const [candidates, thumbnailJobStatus] = await Promise.all([
    listCandidates(sql, user.id, id),
    latestThumbnailJobStatus(sql, user.id, id),
  ])
  const view = projectViewState({
    hasActiveJob: Boolean(job),
    candidateCount: candidates.length,
    thumbnailJobStatus,
  })

  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow="Project"
        title="Kandidat klip"
        description="Pilih momen dengan hook paling kuat, lalu buka editor untuk mengatur crop dan caption."
        actions={
          <Button asChild variant="secondary">
            <Link href="/">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Video baru
            </Link>
          </Button>
        }
      />

      {view === 'progress' && <JobProgress projectId={id} />}
      {view === 'no-job' && (
        <StatePanel
          tone="warning"
          title="Belum ada kandidat klip."
          description="Belum ada analisis yang berjalan untuk proyek ini."
          action={
            <Button asChild variant="secondary">
              <Link href="/">Masukkan link</Link>
            </Button>
          }
        />
      )}

      {candidates.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black tracking-[-0.025em]">Hasil teratas</h2>
            <span className="text-sm text-muted">{candidates.length} kandidat</span>
          </div>
          <CandidateList candidates={candidates} />
        </div>
      )}
    </section>
  )
}
