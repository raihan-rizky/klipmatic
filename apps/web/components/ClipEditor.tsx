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
  type VisualTransform,
} from '@klipmatic/engine'
import { StatePanel } from '@/components/StatePanel'
import { Button } from '@/components/ui/button'
import { CaptionControls } from '@/components/editor/CaptionControls'
import { CropControls } from '@/components/editor/CropControls'
import { EditorHeader } from '@/components/editor/EditorHeader'
import { EditorToasts } from '@/components/editor/EditorToasts'
import { EditorWorkspace } from '@/components/editor/EditorWorkspace'
import {
  createEditorHistory,
  editorHistoryReducer,
} from '@/components/editor/editorHistory'
import { editorViewState } from '@/components/editor/editorViewState'
import { LayerInspector } from '@/components/editor/LayerInspector'
import { MediaLibrary } from '@/components/editor/MediaLibrary'
import type {
  CanvasSelection,
  CanvasSelectionCommit,
} from '@/components/editor/CanvasSelectionOverlay'
import {
  TimelineEditor,
  type TimelineSelection,
  type TimelineTransport,
} from '@/components/editor/TimelineEditor'
import { TimelinePreview } from '@/components/editor/TimelinePreview'
import { ShortcutHelpDialog } from '@/components/editor/ShortcutHelpDialog'
import { useGlobalShortcuts } from '@/components/editor/useGlobalShortcuts'
import { useEditorAutosave } from '@/components/editor/useEditorAutosave'
import { useToasts } from '@/components/editor/useToasts'
import type { ClipEditorPayload } from '@/lib/clipTypes'
import { BUILTIN_MEDIA, getBuiltInAsset } from '@/lib/builtinMedia'
import { browserExportSupport, exportClipMp4 } from '@/lib/browserExport'
import { detectFaceFocusX } from '@/lib/faceFocus'
import { loadSegmentObjectUrl } from '@/lib/segmentCache'

export function ClipEditor({ clipId }: { clipId: string }) {
  const [payload, setPayload] = useState<ClipEditorPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let pollTimer: number | null = null

    function pollAgain() {
      pollTimer = window.setTimeout(() => void load(), 2000)
    }

    async function load() {
      try {
        const response = await fetch(`/api/clips/${clipId}`, {
          cache: 'no-store',
        })
        const body = (await response.json().catch(() => ({}))) as
          | ClipEditorPayload
          | { error?: { message?: string } }
        if (!active) return
        if (!response.ok || !('clip' in body)) {
          if (!('segment' in body)) {
            setError(
              'error' in body
                ? body.error?.message ?? 'Editor gagal dimuat.'
                : 'Editor gagal dimuat.',
            )
          }
          pollAgain()
          return
        }
        setError(null)
        setPayload(body)
        if (body.segment.status === 'pending') pollAgain()
      } catch {
        if (!active) return
        pollAgain()
      }
    }

    void load()
    return () => {
      active = false
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [clipId])

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
        description={
          error
            ? `${error} Mencoba lagi otomatis.`
            : 'Worker sedang mengambil rentang video yang kamu pilih.'
        }
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
  const [assets, setAssets] = useState(payload.assets)
  const initialTrack = history.present.timeline.tracks.find(
    (track) => track.id === history.present.timeline.primaryTrackId,
  )
  const [selected, setSelected] = useState<TimelineSelection | null>(() =>
    initialTrack?.clips[0]
      ? {
          kind: 'clip',
          trackId: initialTrack.id,
          clipId: initialTrack.clips[0].id,
        }
      : null,
  )
  const [playhead, setPlayhead] = useState(() =>
    Math.min(10, payload.clip.durationSec / 2),
  )
  const [playing, setPlaying] = useState(false)
  const { toasts, showToast, dismissToast } = useToasts()
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [transitionDragActive, setTransitionDragActive] = useState(false)
  const transportRef = useRef<TimelineTransport | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const primaryVideoRef = useRef<HTMLVideoElement | null>(null)
  const candidateAssetId = payload.clip.editSpec.timeline.tracks
    .find((track) => track.id === payload.clip.editSpec.timeline.primaryTrackId)
    ?.clips[0]?.assetId ?? payload.assets[0]!.id
  const timelineContext = useMemo<TimelineContext>(
    () => ({
      candidateDuration: payload.clip.durationSec,
      sourceId: payload.clip.id,
      candidateAssetId,
      assets: Object.fromEntries([...BUILTIN_MEDIA, ...assets].map((asset) => [asset.id, {
        id: asset.id,
        mediaType: asset.mediaType,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        hasAudio: asset.hasAudio,
      }])),
    }),
    [assets, candidateAssetId, payload.clip.durationSec, payload.clip.id],
  )
  const assetNames = useMemo(() => Object.fromEntries([
    ...BUILTIN_MEDIA.map((asset) => [asset.id, asset.name] as const),
    ...assets.map((asset) => [asset.id, asset.name] as const),
  ]), [assets])
  const selectFirstClip = useCallback(() => {
    const primary = history.present.timeline.tracks.find(
      (track) => track.id === history.present.timeline.primaryTrackId,
    )
    const clip = primary?.clips[0]
    if (primary && clip) {
      setSelected({ kind: 'clip', trackId: primary.id, clipId: clip.id })
    }
  }, [history.present])
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
        (selected?.kind === 'track' || selected?.kind === 'clip') &&
        command.trackId === selected.trackId
      ) {
        setSelected(null)
      } else if (
        selected?.kind === 'transition' &&
        !next.timeline.transitions.some(
          (transition) => transition.id === selected.transitionId,
        )
      ) {
        setSelected(null)
      }
    },
    [history.present, selected, timelineContext],
  )

  const frameRate = history.present.output.frameRate
  const timelineDuration = history.present.timeline.duration
  const shortcuts = useMemo(() => ({
    onTogglePlay: () => setPlaying((value) => !value),
    onSplit: () => transportRef.current?.split(),
    onDeleteSelected: () => transportRef.current?.remove(),
    onUndo: () => historyDispatch({ type: 'undo' }),
    onRedo: () => historyDispatch({ type: 'redo' }),
    onStepFrame: (direction: -1 | 1, coarse: boolean) =>
      setPlayhead((value) => Math.min(
        Math.max(value + direction * (coarse ? 1 : 1 / frameRate), 0),
        timelineDuration,
      )),
    onJumpToStart: () => setPlayhead(0),
    onJumpToEnd: () => setPlayhead(timelineDuration),
    onShowShortcuts: () => setShortcutsOpen(true),
  }), [frameRate, timelineDuration])
  useGlobalShortcuts(shortcuts)

  const insertAsset = useCallback((
    assetId: string,
    placement: { timelineStart?: number; transform?: VisualTransform } = {},
  ) => {
    const builtIn = getBuiltInAsset(assetId)
    const asset = assets.find((item) => item.id === assetId) ?? builtIn
    if (!asset || asset.status !== 'ready') {
      showToast('Media belum siap dipakai. Tunggu proses pengecekan selesai.', 'warning')
      return
    }
    const id = globalThis.crypto.randomUUID()
    const visual = asset.mediaType !== 'audio'
    const trackId = visual ? 'media-visuals' : 'media-audio'
    const clipId = `clip:${id}`
    if (builtIn && !assets.some((item) => item.id === builtIn.id)) {
      setAssets((current) => [...current, builtIn])
    }
    const initialTransform = placement.transform ?? builtIn?.defaultTransform
    dispatchCommand({
      type: 'insertAsset',
      assetId,
      trackId,
      trackName: visual ? 'Media visual' : 'Media audio',
      clipId,
      timelineStart: placement.timelineStart ?? playhead,
      ...(visual && initialTransform
        ? { initialTransform }
        : {}),
      ...(asset.mediaType === 'video' && asset.hasAudio
        ? {
            linkGroupId: `link:${id}`,
            linkedAudio: {
              trackId: 'media-audio',
              trackName: 'Media audio',
              clipId: `clip:${globalThis.crypto.randomUUID()}:audio`,
            },
          }
        : {}),
    })
    setSelected({ kind: 'clip', trackId, clipId })
    setPlaying(false)
  }, [assets, dispatchCommand, playhead, showToast])

  const canvasSelection = useMemo<CanvasSelection | null>(() => {
    if (selected?.kind !== 'clip') {
      return history.present.captions.enabled
        ? {
            kind: 'caption',
            positionX: history.present.captions.positionX,
            positionY: history.present.captions.positionY,
          }
        : null
    }
    const track = history.present.timeline.tracks.find(
      (item) => item.id === selected.trackId,
    )
    const clip = track?.clips.find((item) => item.id === selected.clipId)
    if (
      track?.type === 'video' &&
      track.id !== history.present.timeline.primaryTrackId &&
      clip?.transform
    ) {
      const asset = assets.find((item) => item.id === clip.assetId)
      return {
        kind: 'asset',
        trackId: track.id,
        clipId: clip.id,
        transform: clip.transform,
        aspectRatio:
          asset?.width && asset.height ? asset.width / asset.height : 1,
      }
    }
    return history.present.captions.enabled
      ? {
          kind: 'caption',
          positionX: history.present.captions.positionX,
          positionY: history.present.captions.positionY,
        }
      : null
  }, [assets, history.present, selected])

  const commitCanvasSelection = useCallback((commit: CanvasSelectionCommit) => {
    if (commit.kind === 'caption') {
      dispatchCommand({
        type: 'updateCaptions',
        captions: {
          positionX: commit.positionX,
          positionY: commit.positionY,
        },
      })
      return
    }
    dispatchCommand({
      type: 'updateVisualTransform',
      trackId: commit.trackId,
      clipId: commit.clipId,
      transform: commit.transform,
    })
  }, [dispatchCommand])

  async function autoFocus(): Promise<void> {
    const video = primaryVideoRef.current
    if (!video) {
      showToast('Preview belum siap. Coba lagi setelah frame video muncul.', 'warning')
      return
    }
    showToast('Mendeteksi wajah di frame aktif…', 'info')
    try {
      const focusX = await detectFaceFocusX(video)
      if (focusX === null) {
        showToast('Wajah tidak ditemukan. Geser fokus secara manual.', 'warning')
        return
      }
      dispatchCommand({ type: 'updateCrop', crop: { focusX } })
      showToast('Fokus crop mengikuti wajah terbesar di frame ini.', 'success')
    } catch {
      showToast('Auto-focus tidak tersedia. Slider manual tetap bisa dipakai.', 'warning')
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

  async function runExport(): Promise<void> {
    setExporting(true)
    setProgress(0)
    setError(null)
    try {
      await autosave.flush()
      await markRenderStatus('rendering')
      await exportClipMp4({
        assets: assets.map((asset) =>
          asset.id === candidateAssetId ? { ...asset, url: mediaUrl } : asset,
        ),
        spec: history.present,
        words: payload.words,
        title: payload.clip.title,
        onProgress: setProgress,
      })
      await markRenderStatus('done')
      showToast('Ekspor selesai dan file sudah diunduh.', 'success')
    } catch (cause) {
      await markRenderStatus('failed').catch(() => undefined)
      setError(cause instanceof Error ? cause.message : 'Ekspor gagal.')
    } finally {
      setExporting(false)
    }
  }

  const support = browserExportSupport(history.present)
  // Memoize supaya TimelinePreview tidak membuat ulang controller tiap kali
  // playhead berubah; tanpa ini identitas array berubah setiap render.
  const uploadedAssets = useMemo(
    () => assets.filter((asset) => asset.id !== candidateAssetId && !asset.id.startsWith('builtin:')),
    [assets, candidateAssetId],
  )
  const previewAssets = useMemo(
    () => assets.map((asset) =>
      asset.id === candidateAssetId ? { ...asset, url: mediaUrl } : asset,
    ),
    [assets, candidateAssetId, mediaUrl],
  )
  const expiringAssets = useMemo(() => uploadedAssets.filter((asset) => asset.expiresSoon), [uploadedAssets])
  const expiredAssets = useMemo(() => uploadedAssets.filter((asset) => asset.status === 'expired'), [uploadedAssets])
  const expiringSeenRef = useRef(false)
  useEffect(() => {
    if (expiringAssets.length === 0) {
      expiringSeenRef.current = false
      return
    }
    if (expiringSeenRef.current) return
    expiringSeenRef.current = true
    showToast(
      `${expiringAssets.map((asset) => asset.name).join(', ')} akan dihapus kurang dari 1 hari kalau project tidak dipakai.`,
      'warning',
    )
  }, [expiringAssets, showToast])
  useEffect(() => {
    if (expiredAssets.length === 0) return
    setError(
      `Media kedaluwarsa: ${expiredAssets.map((asset) => asset.name).join(', ')}. Gunakan Ganti di Media Library untuk memulihkan clip terkait.`,
    )
  }, [expiredAssets])
  const showGeneralControls = !selected || selected.kind === 'track' || selected.kind === 'clip'
  const inspector = (
    <div className="divide-y divide-border">
      <LayerInspector
        spec={history.present}
        selected={selected}
        onCommand={dispatchCommand}
        assetNames={assetNames}
        onSelectFirstClip={selectFirstClip}
      />
      {showGeneralControls ? <div className="p-5">
        <CropControls
          spec={history.present}
          onCommand={dispatchCommand}
          onAutoFocus={() => void autoFocus()}
        />
      </div> : null}
      {showGeneralControls ? <div className="p-5">
        <CaptionControls spec={history.present} onCommand={dispatchCommand} />
      </div> : null}
    </div>
  )

  return (
    <>
      <ShortcutHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <EditorWorkspace
        header={
          <EditorHeader
            title={payload.clip.title}
            duration={history.present.timeline.duration}
            timingPrecision={payload.clip.timingPrecision}
            saveStatus={autosave.status}
            onRetry={() => void autosave.retry().catch(() => undefined)}
            exporting={exporting}
            exportProgress={progress}
            exportSupported={support.supported}
            exportReason={support.reason}
            onExport={() => void runExport()}
          />
        }
        preview={
          <div className="relative">
            <TimelinePreview
              spec={history.present}
              assets={previewAssets}
              words={payload.words}
              playhead={playhead}
              playing={playing}
              onPlayheadChange={setPlayhead}
              onPlayingChange={setPlaying}
              onStall={setError}
              onPrimaryVideoChange={(video) => {
                primaryVideoRef.current = video
              }}
              canvasSelection={canvasSelection}
              onCanvasCommit={commitCanvasSelection}
              onAssetDrop={insertAsset}
              errorBanner={(error || autosave.error) ? (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-3 rounded-lg border border-danger/60 bg-danger/10 p-3 text-sm"
                >
                  <span>{error ?? autosave.error}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Tutup pesan galat"
                    onClick={() => setError(null)}
                  >
                    ×
                  </Button>
                </div>
              ) : null}
            />
            <EditorToasts toasts={toasts} onDismiss={dismissToast} />
          </div>
        }
        mediaLibrary={
          <MediaLibrary
            projectId={payload.clip.projectId}
            assets={uploadedAssets}
            builtIns={BUILTIN_MEDIA}
            playhead={playhead}
            onAssetsChange={(next) => setAssets((current) => [
              ...current.filter((asset) =>
                asset.id === candidateAssetId || asset.id.startsWith('builtin:'),
              ),
              ...next,
            ])}
            onInsert={(asset, placement) => insertAsset(asset.id, placement)}
            onReplace={(fromAssetId, toAssetId) => dispatchCommand({
              type: 'replaceAsset',
              fromAssetId,
              toAssetId,
            })}
            selectedTransitionJoint={selected?.kind === 'joint' ? selected.joint : null}
            onTransitionDragStateChange={setTransitionDragActive}
            onAddTransition={(type, duration, joint) => {
              const id = globalThis.crypto.randomUUID()
              dispatchCommand({
                type: 'addTransition',
                transition: {
                  id,
                  type,
                  duration: Math.min(duration, joint.maxDuration),
                  target: {
                    kind: 'between-clips',
                    trackId: joint.trackId,
                    fromClipId: joint.fromClipId,
                    toClipId: joint.toClipId,
                  },
                },
              })
              setSelected({ kind: 'transition', transitionId: id })
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
            onAssetDrop={insertAsset}
            transitionDragActive={transitionDragActive}
            onShowShortcuts={() => setShortcutsOpen(true)}
            transportRef={transportRef}
          />
        }
      />

      {(error || autosave.error) && (
        <div role="alert" className="sr-only">
          {error ?? autosave.error}
        </div>
      )}
    </>
  )
}
