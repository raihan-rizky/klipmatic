'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import {
  applyTimelineCommand,
  type TimelineCommand,
  type TimelineContext,
} from '@cheapclipper/engine'
import { StatePanel } from '@/components/StatePanel'
import { Alert } from '@/components/ui/alert'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'
import { EditorActionBar } from '@/components/editor/EditorActionBar'
import { EditorHeader } from '@/components/editor/EditorHeader'
import { EditorWorkspace } from '@/components/editor/EditorWorkspace'
import {
  createEditorHistory,
  editorHistoryReducer,
} from '@/components/editor/editorHistory'
import { editorViewState } from '@/components/editor/editorViewState'
import { LayerInspector } from '@/components/editor/LayerInspector'
import {
  TimelineEditor,
  type TimelineSelection,
} from '@/components/editor/TimelineEditor'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import { useEditorAutosave } from '@/components/editor/useEditorAutosave'
import type { ClipEditorPayload } from '@/lib/clipTypes'
import { browserExportSupport, exportClipMp4 } from '@/lib/browserExport'
import { detectFaceFocusX } from '@/lib/faceFocus'
import { loadSegmentObjectUrl } from '@/lib/segmentCache'

export function ClipEditor({ clipId }: { clipId: string }) {
  const [payload, setPayload] = useState<ClipEditorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

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
          setError(
            cause instanceof Error
              ? cause.message
              : 'Potongan video gagal dimuat.',
          )
        }
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [clipId, payload?.segment.url])

  const view = editorViewState(
    payload,
    payload?.clip.editSpec ?? null,
    mediaUrl,
    error,
  )
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

  return (
    <ReadyClipEditor clipId={clipId} payload={payload!} mediaUrl={mediaUrl!} />
  )
}

function ReadyClipEditor({
  clipId,
  payload,
  mediaUrl,
}: {
  clipId: string
  payload: ClipEditorPayload
  mediaUrl: string
}) {
  const [history, historyDispatch] = useReducer(
    editorHistoryReducer,
    payload.clip.editSpec,
    createEditorHistory,
  )
  const initialTrack = history.present.timeline.tracks.find(
    (track) => track.id === history.present.timeline.primaryTrackId,
  )
  const [selected, setSelected] = useState<TimelineSelection | null>(() =>
    initialTrack
      ? { trackId: initialTrack.id, clipId: initialTrack.clips[0]?.id }
      : null,
  )
  const [playhead, setPlayhead] = useState(() =>
    Math.min(10, payload.clip.durationSec / 2),
  )
  const [playing, setPlaying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const primaryVideoRef = useRef<HTMLVideoElement | null>(null)
  const timelineContext = useMemo<TimelineContext>(
    () => ({
      candidateDuration: payload.clip.durationSec,
      sourceId: payload.clip.id,
    }),
    [payload.clip.durationSec, payload.clip.id],
  )
  const autosave = useEditorAutosave({
    clipId,
    spec: history.present,
  })

  const dispatchCommand = useCallback(
    (command: TimelineCommand) => {
      const next = applyTimelineCommand(
        history.present,
        command,
        timelineContext,
      )
      if (next === history.present) return
      historyDispatch({ type: 'push', spec: next })
      if (
        (command.type === 'deleteClip' || command.type === 'deleteTrack') &&
        command.trackId === selected?.trackId
      ) {
        setSelected(null)
      }
    },
    [history.present, selected?.trackId, timelineContext],
  )

  async function autoFocus(): Promise<void> {
    const video = primaryVideoRef.current
    if (!video) {
      setNotice('Preview belum siap. Coba lagi setelah frame video muncul.')
      return
    }
    setNotice('Mendeteksi wajah di frame aktif…')
    try {
      const focusX = await detectFaceFocusX(video)
      if (focusX === null) {
        setNotice('Wajah tidak ditemukan. Geser fokus secara manual.')
        return
      }
      dispatchCommand({ type: 'updateCrop', crop: { focusX } })
      setNotice('Fokus crop mengikuti wajah terbesar di frame ini.')
    } catch {
      setNotice('Auto-focus tidak tersedia. Slider manual tetap bisa dipakai.')
    }
  }

  async function markRenderStatus(
    renderStatus: ClipEditorPayload['clip']['renderStatus'],
  ): Promise<void> {
    const response = await fetch(`/api/clips/${clipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editSpec: history.present, renderStatus }),
    })
    if (!response.ok) throw new Error('Status ekspor gagal disimpan.')
  }

  async function saveNow(): Promise<void> {
    setError(null)
    try {
      await autosave.flush()
      setNotice('Perubahan tersimpan.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Perubahan gagal disimpan.',
      )
    }
  }

  async function runExport(): Promise<void> {
    setExporting(true)
    setProgress(0)
    setError(null)
    try {
      await autosave.flush()
      await markRenderStatus('rendering')
      await exportClipMp4({
        url: mediaUrl,
        spec: history.present,
        words: payload.words,
        title: payload.clip.title,
        onProgress: setProgress,
      })
      await markRenderStatus('done')
      setNotice('Ekspor selesai dan file sudah diunduh.')
    } catch (cause) {
      await markRenderStatus('failed').catch(() => undefined)
      setError(cause instanceof Error ? cause.message : 'Ekspor gagal.')
    } finally {
      setExporting(false)
    }
  }

  const support = browserExportSupport(history.present)
  const inspector = (
    <div className="divide-y divide-border">
      <LayerInspector
        spec={history.present}
        selected={selected}
        onCommand={dispatchCommand}
      />
      <div className="p-5">
        <CropControls
          spec={history.present}
          onCommand={dispatchCommand}
          onAutoFocus={() => void autoFocus()}
        />
      </div>
      <div className="p-5">
        <CaptionControls spec={history.present} onCommand={dispatchCommand} />
      </div>
    </div>
  )

  return (
    <>
      <EditorWorkspace
        header={
          <EditorHeader
            title={payload.clip.title}
            duration={history.present.timeline.duration}
            timingPrecision={payload.clip.timingPrecision}
            saveStatus={autosave.status}
            onRetry={() => void autosave.retry().catch(() => undefined)}
          />
        }
        preview={
          <TimelinePreview
            spec={history.present}
            words={payload.words}
            mediaUrl={mediaUrl}
            playhead={playhead}
            playing={playing}
            onPlayheadChange={setPlayhead}
            onPlayingChange={setPlaying}
            onStall={setError}
            onPrimaryVideoChange={(video) => {
              primaryVideoRef.current = video
            }}
          />
        }
        inspector={inspector}
        timeline={
          <TimelineEditor
            spec={history.present}
            candidateDuration={payload.clip.durationSec}
            playhead={playhead}
            selected={selected}
            onPlayheadChange={setPlayhead}
            onSelectionChange={setSelected}
            onCommand={dispatchCommand}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={() => historyDispatch({ type: 'undo' })}
            onRedo={() => historyDispatch({ type: 'redo' })}
            playing={playing}
            onTogglePlay={() => setPlaying((value) => !value)}
          />
        }
      />

      {(notice || error || autosave.error) && (
        <div className="mt-4 space-y-2" aria-live="polite">
          {notice && (
            <Alert tone="success" role="status">
              {notice}
            </Alert>
          )}
          {(error || autosave.error) && (
            <Alert tone="danger" role="alert">
              {error ?? autosave.error}
            </Alert>
          )}
        </div>
      )}

      <EditorActionBar
        saving={autosave.status === 'saving'}
        exporting={exporting}
        exportProgress={progress}
        exportSupported={support.supported}
        exportReason={support.reason}
        onSave={() => void saveNow()}
        onExport={() => void runExport()}
      />
    </>
  )
}
