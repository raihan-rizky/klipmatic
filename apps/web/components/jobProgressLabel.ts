import type { ErrorCode } from '@klipmatic/shared'
import { messageFor } from '@/lib/errorMessages'

export interface JobState {
  status: 'queued' | 'running' | 'done' | 'failed' | 'dead'
  progress: number
  errorCode: string | null
}

/**
 * Dipisahkan dari komponen agar dapat diuji tanpa merender React maupun
 * menyambung ke Realtime.
 */
export function progressLabel(job: JobState): string {
  switch (job.status) {
    case 'queued':
      return 'Menunggu giliran...'
    case 'running':
      return `Memproses... ${job.progress}%`
    case 'done':
      return 'Selesai'
    case 'failed':
    case 'dead':
      return messageFor((job.errorCode ?? 'INTERNAL') as ErrorCode)
  }
}
