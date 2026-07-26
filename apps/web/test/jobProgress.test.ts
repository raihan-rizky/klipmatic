import { describe, expect, test } from 'vitest'
import { progressLabel } from '../components/jobProgressLabel'

describe('progressLabel', () => {
  test('antre', () => {
    expect(progressLabel({ status: 'queued', progress: 0, errorCode: null })).toBe(
      'Menunggu giliran...',
    )
  })

  test('berjalan menampilkan persentase', () => {
    expect(progressLabel({ status: 'running', progress: 42, errorCode: null })).toBe(
      'Memproses... 42%',
    )
  })

  test('selesai', () => {
    expect(progressLabel({ status: 'done', progress: 100, errorCode: null })).toBe('Selesai')
  })

  test('gagal menampilkan pesan Indonesia, bukan kode', () => {
    const label = progressLabel({
      status: 'failed',
      progress: 30,
      errorCode: 'SOURCE_GEOBLOCKED',
    })
    expect(label).toContain('wilayah tertentu')
    expect(label).not.toContain('SOURCE_GEOBLOCKED')
  })

  test('dead diperlakukan seperti gagal', () => {
    const label = progressLabel({
      status: 'dead',
      progress: 10,
      errorCode: 'TRANSCRIBE_FAILED',
    })
    expect(label).not.toContain('TRANSCRIBE_FAILED')
    expect(label.length).toBeGreaterThan(10)
  })

  test('gagal tanpa kode tetap memberi kalimat yang bisa dibaca', () => {
    expect(
      progressLabel({ status: 'failed', progress: 0, errorCode: null }).length,
    ).toBeGreaterThan(10)
  })
})
