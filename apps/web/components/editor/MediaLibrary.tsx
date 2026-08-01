'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, ImageIcon, Music2, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import type { VisualTransform } from '@cheapclipper/engine'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BUILTIN_MEDIA,
  type BuiltInCategory,
  type BuiltInMediaAsset,
} from '@/lib/builtinMedia'
import type { ResolvedMediaAsset } from '@/lib/clipTypes'
import { PROJECT_MEDIA_QUOTA_BYTES } from '@/lib/mediaAssetConfig'
import { uploadMediaAsset } from './assetUpload'
import { PresetCard } from './PresetCard'

export type InsertMediaAsset = (
  asset: ResolvedMediaAsset,
  placement?: { timelineStart?: number; transform?: VisualTransform },
) => void

export interface MediaLibraryProps {
  projectId: string
  assets: ResolvedMediaAsset[]
  playhead: number
  onAssetsChange: (assets: ResolvedMediaAsset[]) => void
  onInsert: InsertMediaAsset
  onReplace?: (fromAssetId: string, toAssetId: string) => void
  builtIns?: readonly BuiltInMediaAsset[]
}

interface Usage {
  usedBytes: number
  limitBytes: number
}

const GROUPS = [
  ['ready', 'Siap dipakai'],
  ['uploading', 'Sedang di-upload'],
  ['failed', 'Gagal'],
  ['expired', 'Kedaluwarsa'],
] as const

type MediaTab = 'uploads' | BuiltInCategory

const TABS: ReadonlyArray<{ id: MediaTab; label: string }> = [
  { id: 'uploads', label: 'Uploads' },
  { id: 'sfx', label: 'Sound effects' },
  { id: 'sticker', label: 'Stickers' },
  { id: 'photo', label: 'Photos' },
  { id: 'background', label: 'Backgrounds' },
]

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function initialUsage(assets: ResolvedMediaAsset[]): Usage {
  return {
    usedBytes: assets
      .filter((asset) => asset.status === 'ready' || asset.status === 'uploading')
      .reduce((total, asset) => total + asset.bytes, 0),
    limitBytes: PROJECT_MEDIA_QUOTA_BYTES,
  }
}

function MediaIcon({ type }: { type: ResolvedMediaAsset['mediaType'] }) {
  const Icon = type === 'image' ? ImageIcon : type === 'audio' ? Music2 : Film
  return <Icon className="size-5" aria-hidden="true" />
}

export function MediaLibrary({
  projectId,
  assets,
  playhead,
  onAssetsChange,
  onInsert,
  onReplace,
  builtIns = BUILTIN_MEDIA,
}: MediaLibraryProps) {
  const [items, setItems] = useState(assets)
  const [usage, setUsage] = useState(() => initialUsage(assets))
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const pendingReplacements = useRef(new Map<string, string>())
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const [activeTab, setActiveTab] = useState<MediaTab>('uploads')
  const [query, setQuery] = useState('')
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  const stopPreview = useCallback(() => {
    if (previewAudio.current) {
      previewAudio.current.pause()
      previewAudio.current.currentTime = 0
      previewAudio.current.removeAttribute('src')
      previewAudio.current = null
    }
    setPreviewingId(null)
  }, [])

  useEffect(() => () => {
    if (!previewAudio.current) return
    previewAudio.current.pause()
    previewAudio.current.removeAttribute('src')
    previewAudio.current = null
  }, [])

  useEffect(() => {
    setItems(assets)
    setUsage(initialUsage(assets))
  }, [assets])

  const hasUploading = items.some((asset) => asset.status === 'uploading')

  useEffect(() => {
    if (!hasUploading) return
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/assets`, {
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('Status upload belum bisa dicek.')
        const body = await response.json() as {
          assets: ResolvedMediaAsset[]
          usage: Usage
        }
        if (!active) return
        setItems(body.assets)
        setUsage(body.usage)
        onAssetsChange(body.assets)
        for (const asset of body.assets) {
          const fromAssetId = pendingReplacements.current.get(asset.id)
          if (fromAssetId && asset.status === 'ready') {
            pendingReplacements.current.delete(asset.id)
            onReplace?.(fromAssetId, asset.id)
            setMessage(`${asset.name} siap dan sudah menggantikan media lama.`)
          }
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : 'Status upload gagal dicek.')
        }
      }
    }
    const timer = window.setInterval(refresh, 2_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [hasUploading, onAssetsChange, onReplace, projectId])

  const grouped = useMemo(() => Object.fromEntries(GROUPS.map(([status]) => [
    status,
    items.filter((asset) => asset.status === status),
  ])) as Record<ResolvedMediaAsset['status'], ResolvedMediaAsset[]>, [items])

  const visiblePresets = useMemo(() => {
    if (activeTab === 'uploads') return []
    const needle = query.trim().toLowerCase()
    return builtIns.filter((asset) =>
      asset.category === activeTab &&
      (!needle || `${asset.name} ${asset.category}`.toLowerCase().includes(needle)),
    )
  }, [activeTab, builtIns, query])

  const togglePreview = (asset: BuiltInMediaAsset) => {
    if (previewingId === asset.id) {
      stopPreview()
      return
    }
    stopPreview()
    const audio = new Audio(asset.url)
    audio.preload = 'none'
    audio.onended = () => {
      if (previewAudio.current === audio) {
        previewAudio.current = null
        setPreviewingId(null)
      }
    }
    previewAudio.current = audio
    setPreviewingId(asset.id)
    void audio.play().catch(() => {
      if (previewAudio.current === audio) stopPreview()
      setMessage(`${asset.name} belum bisa dipreview.`)
    })
  }

  const publish = (next: ResolvedMediaAsset[]) => {
    setItems(next)
    setUsage(initialUsage(next))
    onAssetsChange(next)
  }

  const uploadFile = async (
    file: File,
    replaceAssetId?: string,
  ) => {
    setMessage(`${file.name} mulai di-upload.`)
    setProgress(0)
    try {
      const asset = await uploadMediaAsset(projectId, file, setProgress)
      if (replaceAssetId) pendingReplacements.current.set(asset.id, replaceAssetId)
      publish([...items, asset])
      setMessage(`${file.name} selesai di-upload dan sedang dicek.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload media gagal.')
    } finally {
      setProgress(null)
    }
  }

  const remove = async (asset: ResolvedMediaAsset) => {
    const response = await fetch(
      `/api/projects/${projectId}/assets/${asset.id}`,
      { method: 'DELETE' },
    )
    if (!response.ok) {
      setMessage(`${asset.name} gagal dihapus.`)
      return
    }
    publish(items.filter((item) => item.id !== asset.id))
    setMessage(`${asset.name} sudah dihapus.`)
  }

  return (
    <section aria-label="Media project" className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-black">Media</h2>
          <p className="text-xs text-muted">
            {formatBytes(usage.usedBytes)} / {formatBytes(usage.limitBytes)}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => uploadInput.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          Upload media
        </Button>
        <input
          ref={uploadInput}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,video/mp4,video/webm,video/quicktime"
          aria-label="Pilih media untuk di-upload"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void uploadFile(file)
            event.currentTarget.value = ''
          }}
        />
      </div>

      {progress !== null ? (
        <div className="space-y-1 text-xs text-muted">
          <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Kategori media"
        className="flex gap-1 overflow-x-auto pb-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="media-tab-panel"
            className={`min-h-11 shrink-0 rounded-lg px-3 text-xs font-black transition ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-raised text-muted hover:text-foreground'
            }`}
            onClick={() => {
              stopPreview()
              setActiveTab(tab.id)
              setQuery('')
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== 'uploads' ? (
        <label className="relative block">
          <span className="sr-only">Cari preset</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Cari preset"
            placeholder="Cari preset"
            value={query}
            className="pl-9"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      ) : null}

      <div id="media-tab-panel" role="tabpanel">
      {activeTab === 'uploads' ? (
        <>

      {GROUPS.map(([status, label]) => {
        const group = grouped[status]
        if (group.length === 0) return null
        return (
          <section key={status} aria-labelledby={`media-${status}`} className="space-y-2">
            <h3 id={`media-${status}`} className="text-xs font-black uppercase tracking-wide text-muted">
              {label}
            </h3>
            <ul className="space-y-2">
              {group.map((asset) => (
                <li key={asset.id} className="rounded-xl border border-border bg-surface-raised p-2">
                  <div className="flex items-center gap-2">
                    {asset.status === 'ready' ? (
                      <button
                        type="button"
                        draggable
                        aria-label={`Tambahkan ${asset.name}`}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => onInsert(asset, { timelineStart: playhead })}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'copy'
                          event.dataTransfer.setData(
                            'application/x-cheapclipper-asset',
                            JSON.stringify({ assetId: asset.id }),
                          )
                        }}
                      >
                        <MediaIcon type={asset.mediaType} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{asset.name}</span>
                          <span className="block text-xs text-muted">{formatBytes(asset.bytes)}</span>
                        </span>
                      </button>
                    ) : (
                      <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2">
                        <MediaIcon type={asset.mediaType} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{asset.name}</span>
                          <span className="block text-xs text-muted">{formatBytes(asset.bytes)}</span>
                        </span>
                      </div>
                    )}

                    {asset.status === 'failed' || asset.status === 'expired' ? (
                      <>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          aria-label={asset.status === 'failed' ? `Retry ${asset.name}` : `Ganti ${asset.name}`}
                          onClick={(event) => {
                            const input = event.currentTarget.nextElementSibling as HTMLInputElement | null
                            input?.click()
                          }}
                        >
                          <RefreshCw className="size-4" aria-hidden="true" />
                        </Button>
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,video/mp4,video/webm,video/quicktime"
                          aria-label={asset.status === 'failed'
                            ? `Pilih file untuk retry ${asset.name}`
                            : `Pilih file pengganti ${asset.name}`}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0]
                            if (file) void uploadFile(
                              file,
                              asset.status === 'expired' ? asset.id : undefined,
                            )
                            event.currentTarget.value = ''
                          }}
                        />
                      </>
                    ) : null}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Hapus ${asset.name}`}
                      onClick={() => void remove(asset)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {asset.expiresSoon ? (
                    <p className="mt-1 px-2 text-xs font-bold text-warning">
                      Akan dihapus kurang dari 1 hari
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          Belum ada media. Upload gambar, audio, atau video pertama kamu.
        </p>
      ) : null}
        </>
      ) : visiblePresets.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3">
          {visiblePresets.map((asset) => (
            <li key={asset.id}>
              <PresetCard
                asset={asset}
                previewing={previewingId === asset.id}
                onTogglePreview={() => togglePreview(asset)}
                onInsert={() => onInsert(asset, {
                  timelineStart: playhead,
                  ...(asset.defaultTransform
                    ? { transform: asset.defaultTransform }
                    : {}),
                })}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted">
          Preset tidak ditemukan.
        </p>
      )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
    </section>
  )
}
