'use client'

import { useEffect, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/client'
import { type JobState, progressLabel } from './jobProgressLabel'

export function JobProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobState | null>(null)

  useEffect(() => {
    const supabase = supabaseBrowser()

    void supabase
      .from('jobs')
      .select('status, progress, error_code')
      .eq('id', jobId)
      .single()
      .then(({ data }) => {
        if (data) {
          setJob({ status: data.status, progress: data.progress, errorCode: data.error_code })
        }
      })

    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as {
            status: JobState['status']
            progress: number
            error_code: string | null
          }
          setJob({ status: row.status, progress: row.progress, errorCode: row.error_code })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [jobId])

  if (!job) return <p>Memuat status...</p>

  const failed = job.status === 'failed' || job.status === 'dead'
  return (
    <div>
      <p role="status">{progressLabel(job)}</p>
      {!failed && (
        <progress value={job.progress} max={100}>
          {job.progress}%
        </progress>
      )}
    </div>
  )
}
