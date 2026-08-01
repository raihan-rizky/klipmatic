import { expect, test, vi } from 'vitest'
import { uploadMediaAsset } from '@/components/editor/assetUpload'

interface FakeXhrOptions {
  status?: number
  fail?: boolean
}

class FakeXhr {
  status: number
  private listeners = new Map<string, () => void>()
  readonly progressListeners: Array<(event: ProgressEvent) => void> = []
  readonly headers: Array<[string, string]> = []
  readonly upload = {
    addEventListener: (_type: 'progress', listener: (event: ProgressEvent) => void) => {
      this.progressListeners.push(listener)
    },
  }

  constructor(private readonly options: FakeXhrOptions = {}) {
    this.status = options.status ?? 200
  }

  open = vi.fn()

  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value])
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener)
  }

  send = vi.fn(() => {
    this.progressListeners.forEach((listener) => {
      listener({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent)
    })
    this.listeners.get(this.options.fail ? 'error' : 'load')?.()
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const createdAsset = {
  id: 'asset-1',
  name: 'logo.png',
  mediaType: 'image' as const,
  status: 'uploading' as const,
  url: null,
  bytes: 10,
  width: null,
  height: null,
  duration: null,
  hasAudio: false,
  expiresAt: null,
  expiresSoon: false,
}

test('uploadMediaAsset reports PUT progress then finalizes', async () => {
  const progress: number[] = []
  const fakeXhr = new FakeXhr()
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({
      asset: createdAsset,
      upload: {
        url: 'https://r2.test/signed',
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
      },
    }, 201))
    .mockResolvedValueOnce(jsonResponse({ assetId: 'asset-1', jobId: 'job-1' }))

  const result = await uploadMediaAsset(
    'project-1',
    new File(['0123456789'], 'logo.png', { type: 'image/png' }),
    (value) => progress.push(value),
    { fetch: fetchMock, createXhr: () => fakeXhr },
  )

  expect(progress).toEqual([0, 0.5, 1])
  expect(fakeXhr.open).toHaveBeenCalledWith('PUT', 'https://r2.test/signed', true)
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/projects/project-1/assets/asset-1/complete',
    expect.objectContaining({ method: 'POST' }),
  )
  expect(result.id).toBe('asset-1')
})

test('validates type and size before creating an upload record', async () => {
  const fetchMock = vi.fn()

  await expect(uploadMediaAsset(
    'project-1',
    new File(['text'], 'notes.txt', { type: 'text/plain' }),
    vi.fn(),
    { fetch: fetchMock, createXhr: () => new FakeXhr() },
  )).rejects.toThrow('Format media belum didukung')

  const oversized = new File(['x'], 'huge.png', { type: 'image/png' })
  Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })
  await expect(uploadMediaAsset(
    'project-1',
    oversized,
    vi.fn(),
    { fetch: fetchMock, createXhr: () => new FakeXhr() },
  )).rejects.toThrow('maksimal 10 MB')

  expect(fetchMock).not.toHaveBeenCalled()
})

test('a failed PUT is not finalized and a retry creates a fresh record', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({
      asset: createdAsset,
      upload: { url: 'https://r2.test/first', method: 'PUT', headers: {} },
    }, 201))
    .mockResolvedValueOnce(jsonResponse({
      asset: { ...createdAsset, id: 'asset-2' },
      upload: { url: 'https://r2.test/second', method: 'PUT', headers: {} },
    }, 201))
    .mockResolvedValueOnce(jsonResponse({ assetId: 'asset-2', jobId: 'job-2' }))
  const xhrs = [new FakeXhr({ fail: true }), new FakeXhr()]
  const file = new File(['image'], 'logo.png', { type: 'image/png' })

  await expect(uploadMediaAsset('project-1', file, vi.fn(), {
    fetch: fetchMock,
    createXhr: () => xhrs.shift()!,
  })).rejects.toThrow('Upload ke storage gagal')

  const retried = await uploadMediaAsset('project-1', file, vi.fn(), {
    fetch: fetchMock,
    createXhr: () => xhrs.shift()!,
  })

  expect(retried.id).toBe('asset-2')
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1)
})
