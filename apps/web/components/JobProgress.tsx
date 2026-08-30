'use client'

import { useEffect, useState } from 'react'
import { Check, Circle, CircleAlert, LoaderCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { type JobState, progressLabel } from './jobProgressLabel'

type PipelineJob = JobState & {
  id: string
  type: 'ingest' | 'transcribe' | 'analyze' | 'prepare_thumbnails'
}

const PIPELINE_TYPES = ['ingest', 'transcribe', 'analyze', 'prepare_thumbnails'] as const

export function JobProgress({ projectId }: { projectId: string }) {
  const [job, setJob] = useState<PipelineJob | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  useEffect(() => {
    let active = true

    async function refreshJob() {
      try {
        const response = await fetch(`/api/projects/${projectId}/job`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`JOB_STATUS_${response.status}`)
        const body = await response.json() as {
          job?: {
            id: string
            type: PipelineJob['type']
            status: JobState['status']
            progress: number
            error_code: string | null
          } | null
        }
        const latest = body.job
        if (!active) return
        setInitialLoadDone(true)
        setPollError(null)
        if (!latest) {
          setPollError('Status proses belum tersedia. Muat ulang halaman untuk mencoba lagi.')
          return
        }

        setJob({
          id: latest.id,
          type: latest.type,
          status: latest.status,
          progress: latest.progress,
          errorCode: latest.error_code,
        })

        if (
          latest.type === 'prepare_thumbnails' &&
          (latest.status === 'done' || latest.status === 'failed' || latest.status === 'dead')
        ) {
          window.location.reload()
        }
      } catch (error) {
        console.error('status job gagal dimuat', error)
        if (active) {
          setInitialLoadDone(true)
          setPollError('Status proses gagal dimuat. Muat ulang halaman untuk mencoba lagi.')
        }
      }
    }

    void refreshJob()
    const poll = window.setInterval(() => void refreshJob(), 3000)

    return () => {
      active = false
      window.clearInterval(poll)
    }
  }, [projectId])

  if (!job && !initialLoadDone) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-5 sm:pt-6">
          <p className="sr-only" role="status">Memuat status...</p>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!job) {
    return (
      <Card className="border-danger/35">
        <CardContent className="pt-5 sm:pt-6">
          <p role="alert" className="font-bold text-danger">
            {pollError ?? 'Status proses belum tersedia.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const failed = job.status === 'failed' || job.status === 'dead'
  const currentIndex = PIPELINE_TYPES.indexOf(job.type)
  const labels = ['Ambil video', 'Transkripsi', 'Cari highlight', 'Siapkan preview']

  return (
    <Card className={cn(failed && 'border-danger/35')}>
      <CardContent className="pt-5 sm:pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
              Pipeline aktif
            </p>
            <p role="status" className={cn('mt-1 font-bold', failed && 'text-danger')}>
              {progressLabel(job)}
            </p>
          </div>
          {!failed && (
            <span className="font-mono text-sm font-bold text-primary">{job.progress}%</span>
          )}
        </div>
        {!failed && <Progress className="mt-4" value={job.progress} aria-label="Progress pipeline" />}

        <ol className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {labels.map((label, index) => {
            const complete = index < currentIndex || (index === currentIndex && job.status === 'done')
            const active = index === currentIndex && !complete
            const stageFailed = active && failed
            const Icon = complete ? Check : stageFailed ? CircleAlert : active ? LoaderCircle : Circle
            return (
              <li
                key={label}
                className={cn(
                  'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-3 text-sm font-bold text-muted',
                  (active || complete) && 'border-primary/20 text-foreground',
                  stageFailed && 'border-danger/30 text-danger',
                )}
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-soft',
                    complete && 'bg-primary text-primary-foreground',
                    active && !stageFailed && 'text-primary',
                  )}
                >
                  <Icon
                    className={cn('size-4', active && !stageFailed && 'animate-spin')}
                    aria-hidden="true"
                  />
                </span>
                {label}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
