'use client'

const CACHE_NAME = 'cheapclipper-segments-v1'

export async function loadSegmentObjectUrl(
  clipId: string,
  signedUrl: string,
): Promise<string> {
  const cacheKey = new Request(
    `${window.location.origin}/__cheapclipper_cache__/segments/${encodeURIComponent(clipId)}`,
  )
  let response: Response | undefined
  if ('caches' in window) {
    const cache = await caches.open(CACHE_NAME)
    response = (await cache.match(cacheKey)) ?? undefined
    if (!response) {
      const network = await fetch(signedUrl)
      if (!network.ok) throw new Error('Potongan video gagal diunduh dari storage.')
      await cache.put(cacheKey, network.clone())
      response = network
    }
  } else {
    response = await fetch(signedUrl)
  }
  if (!response.ok) throw new Error('Potongan video tidak tersedia.')
  return URL.createObjectURL(await response.blob())
}
