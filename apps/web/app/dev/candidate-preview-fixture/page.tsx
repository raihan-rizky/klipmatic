import { CandidateList } from '@/components/CandidateList'
import type { CandidateView } from '@/lib/candidates'

const thumbnails = [
  '/presets/photos/mountain-morning.webp',
  '/presets/photos/creative-workspace.webp',
  '/presets/photos/city-night.webp',
  '/presets/photos/abstract-neon.webp',
  '/presets/backgrounds/sunset-gradient.svg',
  '/presets/backgrounds/dark-grid.svg',
  '/presets/stickers/subscribe-badge.svg',
  '/presets/stickers/sparkle-callout.svg',
  '/presets/stickers/red-arrow.svg',
  '/presets/stickers/highlight-circle.svg',
]

const candidates: CandidateView[] = thumbnails.map((thumbnailUrl, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  rank: index + 1,
  startSec: index * 70,
  endSec: index * 70 + 65,
  score: 0.97 - index * 0.04,
  title: `Candidate preview ${index + 1}`,
  hookText: `Hook context untuk candidate ranking ${index + 1}`,
  reason: 'Fixture lokal untuk verifikasi layout modal dan ranked gallery.',
  transcriptSlice: 'Potongan transcript fixture yang cukup panjang untuk menguji wrapping.',
  thumbnailStatus: 'ready',
  thumbnailUrl,
}))

export default function CandidatePreviewFixturePage() {
  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-8">
      <div className="mb-6">
        <p className="text-sm font-bold text-primary">Preview fixture</p>
        <h1 className="mt-1 text-2xl font-black tracking-normal">Top 10 candidates</h1>
      </div>
      <CandidateList candidates={candidates} />
    </main>
  )
}
