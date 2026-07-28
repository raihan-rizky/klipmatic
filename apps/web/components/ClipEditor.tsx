'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import {
  drawCompositeFrame,
  normalizeEditSpec,
  type EditSpecV1,
} from '@cheapclipper/engine'
import { PageHeader } from '@/components/PageHeader'
import { StatePanel } from '@/components/StatePanel'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { EditorPreview } from '@/components/editor/EditorPreview'
import { editorViewState } from '@/components/editor/editorViewState'
import type { ClipEditorPayload } from '@/lib/clipTypes'
import { browserExportSupport, exportClipMp4 } from '@/lib/browserExport'
import { detectFaceFocusX } from '@/lib/faceFocus'
import { loadSegmentObjectUrl } from '@/lib/segmentCache'

export function ClipEditor({ clipId }: { clipId: string }) {
  const [payload, setPayload] = useState<ClipEditorPayload | null>(null)
  const [spec, setSpec] = useState<EditSpecV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const initialized = useRef(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/clips/${clipId}`, { cache: 'no-store' })
    const body = (await response.json().catch(() => ({}))) as
      | ClipEditorPayload
      | { error?: { message?: string } }
    if (!response.ok || !('clip' in body)) {
      setError(
        'error' in body
          ? body.error?.message ?? 'Editor gagal dimuat.'
          : 'Editor gagal dimuat.',
      )
      return
    }
    setPayload(body)
    if (!initialized.current) {
      setSpec(normalizeEditSpec(body.clip.editSpec))
      initialized.current = true
    }
    if (body.segment.status === 'pending') {
      window.setTimeout(() => void load(), 2000)
    }
  }, [clipId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!payload?.segment.url) return
    let active = true
    let objectUrl: string | null = null
    void loadSegmentObjectUrl(clipId, payload.segment.url)
      .then((url) => {
        objectUrl = url
        if (active) setMediaUrl(url)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Potongan video gagal dimuat.')
        }
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [clipId, payload?.segment.url])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !spec || !mediaUrl || !payload) return
    const context = canvas.getContext('2d')
    if (!context) return
    let frame = 0
    const draw = () => {
      if (video.readyState >= 2) {
        drawCompositeFrame(context, video, spec, payload.words, video.currentTime)
      }
      if (!video.paused && !video.ended) frame = requestAnimationFrame(draw)
    }
    const once = () => draw()
    video.addEventListener('loadeddata', once)
    video.addEventListener('seeked', once)
    video.addEventListener('play', once)
    draw()
    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener('loadeddata', once)
      video.removeEventListener('seeked', once)
      video.removeEventListener('play', once)
    }
  }, [mediaUrl, payload, spec])

  async function save(renderStatus: ClipEditorPayload['clip']['renderStatus'] = 'draft') {
    if (!spec) return
    setSaving(true)
    const response = await fetch(`/api/clips/${clipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editSpec: spec, renderStatus }),
    })
    setSaving(false)
    if (!response.ok) {
      setError('Perubahan gagal disimpan.')
      return
    }
    setNotice('Perubahan tersimpan.')
  }

  async function autoFocus() {
    const video = videoRef.current
    if (!video || !spec) return
    setNotice('Mendeteksi wajah di frame aktif…')
    try {
      const focusX = await detectFaceFocusX(video)
      if (focusX === null) {
        setNotice('Wajah tidak ditemukan. Geser fokus secara manual.')
        return
      }
      setSpec(normalizeEditSpec({ ...spec, crop: { ...spec.crop, focusX } }))
      setNotice('Fokus crop mengikuti wajah terbesar di frame ini.')
    } catch {
      setNotice('Auto-focus tidak tersedia. Slider manual tetap bisa dipakai.')
    }
  }

  async function runExport() {
    if (!mediaUrl || !payload || !spec) return
    setExporting(true)
    setProgress(0)
    setError(null)
    try {
      await save('rendering')
      await exportClipMp4({
        url: mediaUrl,
        spec,
        words: payload.words,
        title: payload.clip.title,
        onProgress: setProgress,
      })
      await save('done')
      setNotice('Ekspor selesai dan file sudah diunduh.')
    } catch (cause) {
      await save('failed')
      setError(cause instanceof Error ? cause.message : 'Ekspor gagal.')
    } finally {
      setExporting(false)
    }
  }

  const view = editorViewState(payload, spec, mediaUrl, error)
  if (view === 'error') {
    return (
      <StatePanel
        tone="danger"
        title="Editor gagal dimuat"
        description={error ?? 'Coba buka kembali kandidat dari halaman project.'}
      />
    )
  }
  if (view === 'loading') {
    return (
      <StatePanel
        busy
        title="Memuat editor"
        description="Menyiapkan edit spec dan status klip."
      />
    )
  }
  if (view === 'failed') {
    return (
      <StatePanel
        tone="danger"
        title="Segmen video gagal disiapkan"
        description="Coba buat ulang klip dari kandidat di halaman project."
      />
    )
  }
  if (view === 'preparing') {
    return (
      <StatePanel
        busy
        title={payload?.clip.title ?? 'Menyiapkan potongan video'}
        description="Worker sedang mengambil rentang video yang kamu pilih."
      />
    )
  }
  if (view === 'caching') {
    return (
      <StatePanel
        busy
        title="Mengunduh potongan video"
        description="Video disimpan sementara di cache browser agar preview dan ekspor lebih cepat."
      />
    )
  }

  const readyPayload = payload!
  const readySpec = spec!
  const readyMediaUrl = mediaUrl!
  const support = browserExportSupport()

  return (
    <section>
      <PageHeader
        eyebrow="Editor"
        title={readyPayload.clip.title}
        description="Atur framing dan caption. Preview dan hasil ekspor memakai edit spec yang sama."
        actions={
          <>
            <Badge variant="muted">{readyPayload.clip.durationSec.toFixed(1)} detik</Badge>
            <Badge variant={readyPayload.clip.timingPrecision === 'estimated' ? 'warning' : 'default'}>
              {readyPayload.clip.timingPrecision === 'estimated' ? 'Timing estimasi' : 'Timing presisi'}
            </Badge>
          </>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(300px,380px)_minmax(320px,1fr)_360px]">
        <EditorPreview
          canvasRef={canvasRef}
          videoRef={videoRef}
          mediaUrl={readyMediaUrl}
          spec={readySpec}
          durationSec={readyPayload.clip.durationSec}
          timingPrecision={readyPayload.clip.timingPrecision}
        />

        <Card className="self-start lg:col-span-2 xl:col-span-1">
          <CardHeader className="flex-row items-center gap-3 border-b border-border/70">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SlidersHorizontal className="size-5" aria-hidden="true" />
            </span>
            <CardTitle>Pengaturan klip</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-5 sm:pt-6">
            <div className="pb-6">
              <CropControls
                spec={readySpec}
                onChange={setSpec}
                onAutoFocus={() => void autoFocus()}
              />
            </div>
            <div className="pt-6">
              <CaptionControls spec={readySpec} onChange={setSpec} />
            </div>
          </CardContent>
        </Card>
      </div>

      {(notice || error) && (
        <div className="mt-4 space-y-2" aria-live="polite">
          {notice && <Alert tone="success" role="status">{notice}</Alert>}
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
        </div>
      )}

      <EditorActionBar
        saving={saving}
        exporting={exporting}
        exportProgress={progress}
        exportSupported={support.supported}
        exportReason={support.reason}
        onSave={() => void save()}
        onExport={() => void runExport()}
      />
    </section>
  )
}
