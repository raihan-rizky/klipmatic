import { Clock3, Quote, Sparkles } from 'lucide-react'
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
import { CreateClipButton } from './CreateClipButton'

export function CandidateList({ candidates }: { candidates: CandidateView[] }) {
  if (candidates.length === 0) {
    return (
      <StatePanel
        title="Belum ada kandidat klip."
        description="Kandidat terbaik akan muncul di sini setelah analisis selesai."
      />
    )
  }

  return (
    <ol className="grid gap-4 xl:grid-cols-2">
      {candidates.map((candidate, index) => (
        <li key={candidate.id}>
          <Card className="group h-full transition duration-200 hover:-translate-y-0.5 hover:border-primary/30">
            <CardContent className="flex h-full flex-col pt-5 sm:pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>#{index + 1}</Badge>
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

              <div className="mt-5">
                <h2 className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
                  {candidate.title}
                </h2>
                <div className="mt-4 flex gap-3 rounded-xl border border-primary/10 bg-primary/5 p-4">
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
      ))}
    </ol>
  )
}
