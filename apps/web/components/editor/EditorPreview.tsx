import type { RefObject } from 'react'
import { Film, Smartphone } from 'lucide-react'
import type { EditSpecV1 } from '@cheapclipper/engine'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type EditorPreviewProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  mediaUrl: string
  spec: EditSpecV1
  durationSec: number
  timingPrecision: 'word' | 'estimated'
}

export function EditorPreview({
  canvasRef,
  videoRef,
  mediaUrl,
  spec,
  durationSec,
  timingPrecision,
}: EditorPreviewProps) {
  return (
    <>
      <Card className="overflow-hidden bg-black">
        <CardHeader className="flex-row items-center justify-between border-b border-border/70 bg-surface">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4 text-primary" aria-hidden="true" />
            Preview 9:16
          </CardTitle>
          <Badge variant="muted">1080 × 1920</Badge>
        </CardHeader>
        <CardContent className="flex justify-center bg-black p-4 sm:p-6">
          <canvas
            ref={canvasRef}
            width={spec.output.width}
            height={spec.output.height}
            aria-label="Preview video vertikal"
            className="max-h-[68vh] w-auto max-w-full rounded-xl bg-[#050505] shadow-2xl"
            style={{ aspectRatio: '9 / 16' }}
          />
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Film className="size-4 text-primary" aria-hidden="true" />
            Video sumber
          </CardTitle>
          <Badge variant={timingPrecision === 'estimated' ? 'warning' : 'default'}>
            {timingPrecision === 'estimated' ? 'Timing estimasi' : 'Timing presisi'}
          </Badge>
        </CardHeader>
        <CardContent>
          <video
            ref={videoRef}
            src={mediaUrl}
            controls
            playsInline
            className="aspect-video w-full rounded-xl bg-black"
          />
          <p className="mt-3 text-xs text-muted">{durationSec.toFixed(1)} detik</p>
        </CardContent>
      </Card>
    </>
  )
}
