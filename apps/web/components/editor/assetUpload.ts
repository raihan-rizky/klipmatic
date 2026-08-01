import type { ResolvedMediaAsset } from '@/lib/clipTypes'
import {
  ALLOWED_MEDIA_MIME,
  MEDIA_LIMITS,
  type MediaType,
} from '@/lib/mediaAssetConfig'

interface UploadXhr {
  status: number
  upload: {
    addEventListener(
      type: 'progress',
      listener: (event: ProgressEvent) => void,
    ): void
  }
  open(method: string, url: string, async: boolean): void
  setRequestHeader(name: string, value: string): void
  addEventListener(type: 'load' | 'error' | 'abort', listener: () => void): void
  send(body: Blob): void
}

export interface UploadMediaDependencies {
  fetch?: typeof globalThis.fetch
  createXhr?: () => UploadXhr
}

interface CreateUploadResponse {
  asset: ResolvedMediaAsset
  upload: {
    url: string
    method: 'PUT'
    headers: Record<string, string>
  }
}

function mediaTypeFor(file: File): MediaType | null {
  const entry = (Object.keys(ALLOWED_MEDIA_MIME) as MediaType[]).find((type) =>
    ALLOWED_MEDIA_MIME[type].includes(file.type as never),
  )
  return entry ?? null
}

function sizeLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as
    | (T & { error?: { message?: string } })
    | null
  if (!response.ok) {
    throw new Error(body?.error?.message ?? 'Upload media gagal diproses.')
  }
  if (!body) throw new Error('Respons upload media tidak valid.')
  return body
}

function putFile(
  contract: CreateUploadResponse['upload'],
  file: File,
  onProgress: (value: number) => void,
  createXhr: () => UploadXhr,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = createXhr()
    xhr.open(contract.method, contract.url, true)
    for (const [name, value] of Object.entries(contract.headers)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total))
      }
    })
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1)
        resolve()
      } else {
        reject(new Error(`Upload ke storage gagal (${xhr.status}).`))
      }
    })
    xhr.addEventListener('error', () => reject(new Error('Upload ke storage gagal.')))
    xhr.addEventListener('abort', () => reject(new Error('Upload dibatalkan.')))
    xhr.send(file)
  })
}

export async function uploadMediaAsset(
  projectId: string,
  file: File,
  onProgress: (value: number) => void,
  dependencies: UploadMediaDependencies = {},
): Promise<ResolvedMediaAsset> {
  const mediaType = mediaTypeFor(file)
  if (!mediaType) throw new Error('Format media belum didukung.')
  if (file.size > MEDIA_LIMITS[mediaType]) {
    throw new Error(
      `${mediaType === 'image' ? 'Gambar' : mediaType === 'audio' ? 'Audio' : 'Video'} maksimal ${sizeLabel(MEDIA_LIMITS[mediaType])}.`,
    )
  }
  if (file.size <= 0) throw new Error('File media kosong.')

  const fetcher = dependencies.fetch ?? globalThis.fetch
  const createXhr = dependencies.createXhr ?? (() => new XMLHttpRequest())
  onProgress(0)
  const created = await responseJson<CreateUploadResponse>(await fetcher(
    `/api/projects/${projectId}/assets`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        mediaType,
        mimeType: file.type,
        bytes: file.size,
      }),
    },
  ))
  await putFile(created.upload, file, onProgress, createXhr)
  await responseJson(await fetcher(
    `/api/projects/${projectId}/assets/${created.asset.id}/complete`,
    { method: 'POST' },
  ))
  return created.asset
}
