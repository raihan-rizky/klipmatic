import { JobProgress } from '@/components/JobProgress'

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ job?: string }>
}) {
  const { id } = await params
  const { job } = await searchParams

  return (
    <main>
      <h1>Proyek</h1>
      <p>ID: {id}</p>
      {job ? <JobProgress jobId={job} /> : <p>Tidak ada job aktif.</p>}
    </main>
  )
}
