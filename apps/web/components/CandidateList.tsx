'use client'

import { useRef, useState } from 'react'
import { Clock3, ImageOff, Play, Quote, Sparkles } from 'lucide-react'
import { type CandidateView, formatRange } from '@/lib/candidates'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { StatePanel } from '@/components/StatePanel'
import { CandidatePreviewModal } from './CandidatePreviewModal'
import { CreateClipButton } from './CreateClipButton'

function durationLabel(startSec: number, endSec: number) {
  const duration = Math.max(0, Math.floor(endSec) - Math.floor(startSec))
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`
}

export function CandidateList({ candidates }: { candidates: CandidateView[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [clipIds, setClipIds] = useState<Record<string, string>>({})
  const previewButtons = useRef<Array<HTMLButtonElement | null>>([])

  if (candidates.length === 0) {
    return (
      <StatePanel
        title="Belum ada kandidat klip."
        description="Kandidat terbaik akan muncul di sini setelah analisis selesai."
      />
    )
  }

  const activeCandidate = activeIndex === null ? null : candidates[activeIndex] ?? null

  function rememberClip(candidateId: string, clipId: string) {
    setClipIds((current) => ({ ...current, [candidateId]: clipId }))
  }

  return (
    <>
      <ol className="grid gap-4 xl:grid-cols-2">
        {candidates.map((candidate, index) => {
          const hasPoster = Boolean(candidate.thumbnailUrl) && !broken[candidate.id]
          return (
            <li key={candidate.id}>
              <Card className="group flex h-full flex-col overflow-hidden rounded-lg transition duration-200 hover:-translate-y-0.5 hover:border-primary/30">
                <button
                  ref={(element) => {
                    previewButtons.current[index] = element
                  }}
                  type="button"
                  aria-label={`Preview ${candidate.title}`}
                  className="relative block aspect-video w-full overflow-hidden bg-surface-soft text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onClick={() => setActiveIndex(index)}
                >
                  {hasPoster ? (
                    <img
                      src={candidate.thumbnailUrl!}
                      alt={candidate.title}
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      onError={() => setBroken((current) => ({
                        ...current,
                        [candidate.id]: true,
                      }))}
                    />
                  ) : (
                    <div
                      data-testid="candidate-thumbnail-placeholder"
                      className="grid aspect-video size-full place-items-center bg-surface-soft text-muted"
                    >
                      <ImageOff className="size-8" aria-hidden="true" />
                    </div>
                  )}
                  <span className="absolute left-3 top-3 rounded-md bg-black/80 px-2.5 py-1 text-xs font-black text-white">
                    #{candidate.rank}
                  </span>
                  <span className="absolute bottom-3 right-3 rounded-md bg-black/80 px-2 py-1 font-mono text-xs font-bold text-white">
                    {durationLabel(candidate.startSec, candidate.endSec)}
                  </span>
                  <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition group-hover:scale-105">
                    <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
                  </span>
                </button>

                <CardContent className="flex flex-1 flex-col pt-5 sm:pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="score"
                      aria-label={`skor ${Math.round(candidate.score * 100)}`}
                    >
                      {Math.round(candidate.score * 100)}
                    </Badge>
                    <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {formatRange(candidate.startSec, candidate.endSec)}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h2 className="text-xl font-black tracking-normal sm:text-2xl">
                      {candidate.title}
                    </h2>
                    <div className="mt-4 flex gap-3 rounded-lg border border-primary/10 bg-primary/5 p-4">
                      <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <p className="text-sm font-semibold leading-6 text-foreground">
                        {candidate.hookText}
                      </p>
                    </div>
                    {candidate.reason && (
                      <p className="mt-4 text-sm leading-6 text-muted">
                        <em>{candidate.reason}</em>
                      </p>
                    )}
                  </div>

                  <Accordion type="single" collapsible className="mt-4">
                    <AccordionItem value="transcript" className="border-y">
                      <AccordionTrigger>
                        <span className="inline-flex items-center gap-2">
                          <Quote className="size-4 text-primary" aria-hidden="true" />
                          Lihat kutipan transkrip
                        </span>
                      </AccordionTrigger>
                      <AccordionContent forceMount>
                        <p>{candidate.transcriptSlice}</p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <div className="mt-auto pt-5">
                    <CreateClipButton candidateId={candidate.id} />
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ol>

      {activeCandidate && activeIndex !== null && (
        <CandidatePreviewModal
          candidate={activeCandidate}
          open
          hasPrevious={activeIndex > 0}
          hasNext={activeIndex < candidates.length - 1}
          initialClipId={clipIds[activeCandidate.id] ?? null}
          onOpenChange={(open) => {
            if (!open) {
              const opener = previewButtons.current[activeIndex]
              setActiveIndex(null)
              window.setTimeout(() => opener?.focus(), 0)
            }
          }}
          onPrevious={() => setActiveIndex((current) => current === null ? null : current - 1)}
          onNext={() => setActiveIndex((current) => current === null ? null : current + 1)}
          onClipResolved={rememberClip}
        />
      )}
    </>
  )
}
