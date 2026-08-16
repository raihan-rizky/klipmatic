'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabase/client'

type RenderJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'dead'

const ACTIVE_STATUSES = new Set<RenderJobStatus>(['queued', 'running'])

export function PreviewRenderRefresh({
  projectId,
  hasIncompletePreviews,
}: {
  projectId: string
  hasIncompletePreviews: boolean
}) {
  const router = useRouter()

  useEffect(() => {
    if (!hasIncompletePreviews) return

    const supabase = supabaseBrowser()
    let active = true
    let interval: number | null = null
    let terminalRefreshSent = false

    async function refreshIfRenderActive() {
      const { data } = await supabase
        .from('jobs')
        .select('status')
        .eq('project_id', projectId)
        .eq('type', 'render_previews')
        .order('created_at', { ascending: false })
        .limit(1)
      const status = data?.[0]?.status as RenderJobStatus | undefined
      if (!active) return
      if (status && !ACTIVE_STATUSES.has(status)) {
        if (!terminalRefreshSent) {
          terminalRefreshSent = true
          router.refresh()
        }
        if (interval !== null) window.clearInterval(interval)
        return
      }
      if (status && ACTIVE_STATUSES.has(status)) router.refresh()
    }

    void refreshIfRenderActive()
    interval = window.setInterval(() => void refreshIfRenderActive(), 3000)
    const channel = supabase
      .channel(`preview-renders:${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `project_id=eq.${projectId}` },
        () => void refreshIfRenderActive(),
      )
      .subscribe()

    return () => {
      active = false
      if (interval !== null) window.clearInterval(interval)
      void supabase.removeChannel(channel)
    }
  }, [hasIncompletePreviews, projectId, router])

  return null
}
