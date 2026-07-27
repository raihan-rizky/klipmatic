import { CandidateList } from '@/components/CandidateList'
import { JobProgress } from '@/components/JobProgress'
import { listCandidates, projectViewState } from '@/lib/candidates'
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
      <main>
        <p>Silakan masuk dulu.</p>
      </main>
    )
  }

  const candidates = await listCandidates(sql, user.id, id)
  const view = projectViewState({
    hasActiveJob: Boolean(job),
    candidateCount: candidates.length,
  })

  return (
    <main>
      <h1>Kandidat klip</h1>
      {view === 'progress' && job && <JobProgress jobId={job} />}
      {view === 'no-job' && <p>Belum ada analisis yang berjalan untuk proyek ini.</p>}
      <CandidateList candidates={candidates} />
    </main>
  )
}
