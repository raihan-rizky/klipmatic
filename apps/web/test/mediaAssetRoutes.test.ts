import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const deps = vi.hoisted(() => {
  class AssetError extends Error {
    constructor(
      public readonly code: string,
      message = code,
    ) {
      super(message)
    }
  }
  return {
    AssetError,
    userId: 'user-1' as string | null,
    create: vi.fn(),
    list: vi.fn(),
    finalize: vi.fn(),
    remove: vi.fn(),
    loadObject: vi.fn(),
    signedGet: vi.fn(),
    fetch: vi.fn(),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: deps.userId ? { id: deps.userId } : null } }),
    },
  }),
}))

vi.mock('@/lib/db', () => ({ sql: {} }))
vi.mock('@/lib/mediaAssets', () => ({
  MediaAssetError: deps.AssetError,
  createMediaUpload: deps.create,
  listProjectUploads: deps.list,
  finalizeMediaUpload: deps.finalize,
  deleteProjectUpload: deps.remove,
  loadAssetObject: deps.loadObject,
}))
vi.mock('@/lib/r2', () => ({ signedR2Get: deps.signedGet }))

import {
  GET as GET_ASSETS,
  POST as POST_ASSET,
} from '../app/api/projects/[id]/assets/route'
import { POST as COMPLETE_ASSET } from '../app/api/projects/[id]/assets/[assetId]/complete/route'
import { DELETE as DELETE_ASSET } from '../app/api/projects/[id]/assets/[assetId]/route'
import { GET as GET_CONTENT } from '../app/api/assets/[id]/content/route'

const asset = {
  id: 'asset-1',
  name: 'logo.png',
  mediaType: 'image',
  status: 'uploading',
  url: null,
  bytes: 1_200,
  width: null,
  height: null,
  duration: null,
  hasAudio: false,
  expiresAt: '2026-08-01T12:00:00.000Z',
  expiresSoon: false,
}

beforeEach(() => {
  deps.userId = 'user-1'
  deps.create.mockReset().mockResolvedValue({
    asset,
    upload: {
      url: 'https://upload.test/signed',
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
    },
  })
  deps.list.mockReset().mockResolvedValue({
    assets: [asset],
    usage: { usedBytes: 1_200, limitBytes: 300 * 1024 * 1024 },
  })
  deps.finalize.mockReset().mockResolvedValue({ assetId: 'asset-1', jobId: 'job-1' })
  deps.remove.mockReset().mockResolvedValue(undefined)
  deps.loadObject.mockReset().mockResolvedValue({
    key: 'uploads/user-1/project-1/asset-1/source.png',
    mimeType: 'image/png',
    bytes: 3,
    status: 'ready',
  })
  deps.signedGet.mockReset().mockResolvedValue('https://r2.test/signed')
  deps.fetch.mockReset().mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  )
  vi.stubGlobal('fetch', deps.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('POST asset returns a presigned upload contract', async () => {
  const response = await POST_ASSET(
    new Request('http://localhost/api/projects/project-1/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'logo.png',
        mediaType: 'image',
        mimeType: 'image/png',
        bytes: 1_200,
      }),
    }),
    { params: Promise.resolve({ id: 'project-1' }) },
  )

  expect(response.status).toBe(201)
  await expect(response.json()).resolves.toMatchObject({
    upload: { method: 'PUT', headers: { 'content-type': 'image/png' } },
  })
  expect(deps.create).toHaveBeenCalledWith(
    {},
    'user-1',
    'project-1',
    expect.objectContaining({ name: 'logo.png' }),
  )
})

test('GET assets returns uploads and project usage', async () => {
  const response = await GET_ASSETS(
    new Request('http://localhost/api/projects/project-1/assets'),
    { params: Promise.resolve({ id: 'project-1' }) },
  )
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toMatchObject({
    assets: [{ id: 'asset-1' }],
    usage: { usedBytes: 1_200 },
  })
})

test('asset routes require authentication', async () => {
  deps.userId = null
  const response = await GET_ASSETS(
    new Request('http://localhost/api/projects/project-1/assets'),
    { params: Promise.resolve({ id: 'project-1' }) },
  )
  expect(response.status).toBe(401)
  expect(deps.list).not.toHaveBeenCalled()
})

test('domain errors map to stable HTTP status and code', async () => {
  deps.create.mockRejectedValueOnce(new deps.AssetError('ASSET_TOO_LARGE'))
  const response = await POST_ASSET(
    new Request('http://localhost/api/projects/project-1/assets', {
      method: 'POST',
      body: JSON.stringify({ name: 'huge.mp4' }),
    }),
    { params: Promise.resolve({ id: 'project-1' }) },
  )
  expect(response.status).toBe(413)
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'ASSET_TOO_LARGE' },
  })
})

test('complete and delete routes pass both project and asset IDs', async () => {
  const complete = await COMPLETE_ASSET(
    new Request('http://localhost/complete', { method: 'POST' }),
    { params: Promise.resolve({ id: 'project-1', assetId: 'asset-1' }) },
  )
  expect(complete.status).toBe(200)
  expect(deps.finalize).toHaveBeenCalledWith({}, 'user-1', 'project-1', 'asset-1')

  const removed = await DELETE_ASSET(
    new Request('http://localhost/asset-1', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'project-1', assetId: 'asset-1' }) },
  )
  expect(removed.status).toBe(200)
  expect(deps.remove).toHaveBeenCalledWith({}, 'user-1', 'project-1', 'asset-1')
})

test('asset content rejects a different owner before signing R2', async () => {
  deps.loadObject.mockRejectedValueOnce(new deps.AssetError('ASSET_NOT_FOUND'))
  const response = await GET_CONTENT(
    new Request('http://localhost/api/assets/asset-bob/content'),
    { params: Promise.resolve({ id: 'asset-bob' }) },
  )
  expect(response.status).toBe(404)
  expect(deps.signedGet).not.toHaveBeenCalled()
})

test('asset content streams ready media through same-origin response', async () => {
  const response = await GET_CONTENT(
    new Request('http://localhost/api/assets/asset-1/content'),
    { params: Promise.resolve({ id: 'asset-1' }) },
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(response.headers.get('content-length')).toBe('3')
  expect(deps.fetch).toHaveBeenCalledWith('https://r2.test/signed', { cache: 'no-store' })
})

test('asset content returns conflict until upload probing finishes', async () => {
  deps.loadObject.mockResolvedValueOnce({
    key: 'uploads/source.png',
    mimeType: 'image/png',
    bytes: 3,
    status: 'uploading',
  })
  const response = await GET_CONTENT(
    new Request('http://localhost/api/assets/asset-1/content'),
    { params: Promise.resolve({ id: 'asset-1' }) },
  )
  expect(response.status).toBe(409)
  expect(deps.signedGet).not.toHaveBeenCalled()
})
