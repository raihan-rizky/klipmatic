import type { ClipPreviewStatus } from './clipTypes'

interface ErrorBody {
  error?: { message?: unknown }
}

export async function createPreviewClip(candidateId: string, signal?: AbortSignal) {
  const response = await fetch('/api/clips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidateId }),
    signal,
  })
  const body = (await response.json().catch(() => ({}))) as ErrorBody & {
    clipId?: unknown
    jobId?: unknown
  }
  if (!response.ok || typeof body.clipId !== 'string') {
    throw new Error(
      typeof body.error?.message === 'string'
        ? body.error.message
        : 'Gagal menyiapkan preview.',
    )
  }
  return {
    clipId: body.clipId,
    jobId: typeof body.jobId === 'string' ? body.jobId : null,
  }
}

export async function fetchClipPreviewStatus(
  clipId: string,
  signal?: AbortSignal,
): Promise<ClipPreviewStatus> {
  const response = await fetch(`/api/clips/${clipId}/preview`, {
    signal,
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => ({}))) as ErrorBody &
    Partial<ClipPreviewStatus>
  if (!response.ok || body.clipId !== clipId) {
    throw new Error(
      typeof body.error?.message === 'string'
        ? body.error.message
        : 'Gagal memuat preview.',
    )
  }
  return body as ClipPreviewStatus
}
