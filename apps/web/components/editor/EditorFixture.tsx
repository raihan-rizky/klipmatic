'use client'

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import { Pause, Play } from 'lucide-react'
import {
  applyTimelineCommand,
  createDefaultEditSpecV2,
  type TimelineCommand,
} from '@cheapclipper/engine'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CaptionControls } from './CaptionControls'
import { CropControls } from './CropControls'
import { EditorActionBar } from './EditorActionBar'
import { EditorHeader } from './EditorHeader'
import { EditorWorkspace } from './EditorWorkspace'
import {
  createEditorHistory,
  editorHistoryReducer,
} from './editorHistory'
import { LayerInspector } from './LayerInspector'
import { TimelineEditor, type TimelineSelection } from './TimelineEditor'
import type { AutosaveStatus } from './useEditorAutosave'

const FIXTURE_CONTEXT = {
  candidateDuration: 30,
  sourceId: 'editor-fixture',
}
const FIXTURE_SPEC = createDefaultEditSpecV2(FIXTURE_CONTEXT)

export function EditorFixture() {
  const [history, historyDispatch] = useReducer(
    editorHistoryReducer,
    FIXTURE_SPEC,
    createEditorHistory,
  )
  const primaryTrack = history.present.timeline.tracks.find(
    (track) => track.id === history.present.timeline.primaryTrackId,
  )!
  const [selected, setSelected] = useState<TimelineSelection | null>({
    trackId: primaryTrack.id,
    clipId: primaryTrack.clips[0]?.id,
  })
  const [playhead, setPlayhead] = useState(10)
  const [playing, setPlaying] = useState(false)
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>('saved')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [notice, setNotice] = useState(
    'Fixture lokal: semua kontrol real, tanpa fetch media.',
  )
  const initialSpecRef = useRef(history.present)

  useEffect(() => {
    if (history.present === initialSpecRef.current) return
    setSaveStatus('unsaved')
    const saving = window.setTimeout(() => setSaveStatus('saving'), 500)
    const saved = window.setTimeout(() => setSaveStatus('saved'), 900)
    return () => {
      window.clearTimeout(saving)
      window.clearTimeout(saved)
    }
  }, [history.present])

  const dispatchCommand = useCallback(
    (command: TimelineCommand) => {
      const next = applyTimelineCommand(
        history.present,
        command,
        FIXTURE_CONTEXT,
      )
      if (next !== history.present) {
        historyDispatch({ type: 'push', spec: next })
      }
    },
    [history.present],
  )

  async function simulateExport(): Promise<void> {
    setExporting(true)
    setExportProgress(0)
    for (const progress of [0.2, 0.45, 0.7, 1]) {
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      setExportProgress(progress)
    }
    setExporting(false)
    setNotice('Simulasi export selesai. Timeline production memakai WebCodecs.')
  }

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
          onAutoFocus={() =>
            setNotice('Fixture autofocus: fokus dikunci ke subjek tengah.')
          }
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
            title="Fixture — Podcast Product"
            duration={history.present.timeline.duration}
            timingPrecision="word"
            saveStatus={saveStatus}
            onRetry={() => setSaveStatus('saved')}
          />
        }
        preview={
          <FixturePreview
            playhead={playhead}
            duration={history.present.timeline.duration}
            playing={playing}
            onPlayheadChange={setPlayhead}
            onPlayingChange={setPlaying}
          />
        }
        inspector={inspector}
        timeline={
          <TimelineEditor
            spec={history.present}
            candidateDuration={FIXTURE_CONTEXT.candidateDuration}
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
      <Alert tone="neutral" role="status" className="mt-4">
        {notice}
      </Alert>
      <EditorActionBar
        saving={saveStatus === 'saving'}
        exporting={exporting}
        exportProgress={exportProgress}
        exportSupported
        onSave={() => setSaveStatus('saved')}
        onExport={() => void simulateExport()}
      />
    </>
  )
}

function FixturePreview({
  playhead,
  duration,
  playing,
  onPlayheadChange,
  onPlayingChange,
}: {
  playhead: number
  duration: number
  playing: boolean
  onPlayheadChange: (value: number) => void
  onPlayingChange: (value: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, '#17222b')
    gradient.addColorStop(1, '#07090b')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#c7ff45'
    context.beginPath()
    context.arc(540, 650, 220, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#111519'
    context.fillRect(310, 900, 460, 620)
    context.fillStyle = '#ffffff'
    context.font = '900 84px Inter, sans-serif'
    context.textAlign = 'center'
    context.fillText('BUILD FAST', 540, 1650)
    context.fillStyle = '#c7ff45'
    context.fillText('STAY SHARP', 540, 1750)
  }, [])

  return (
    <section className="flex min-h-0 flex-col bg-black" aria-label="Video preview">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
        <canvas
          ref={canvasRef}
          width={1080}
          height={1920}
          aria-label="Preview video vertikal"
          className="max-h-[56vh] w-auto max-w-full rounded-xl bg-black shadow-2xl"
          style={{ aspectRatio: '9 / 16' }}
        />
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 bg-surface px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={playing ? 'Jeda preview' : 'Putar preview'}
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </Button>
        <span className="min-w-20 text-xs tabular-nums text-muted">
          {playhead.toFixed(1)} / {duration.toFixed(1)}
        </span>
        <input
          type="range"
          aria-label="Posisi playhead"
          min={0}
          max={duration}
          step={1 / 30}
          value={playhead}
          onChange={(event) =>
            onPlayheadChange(Number(event.currentTarget.value))
          }
          className="min-w-0 flex-1 accent-primary"
        />
      </div>
    </section>
  )
}
