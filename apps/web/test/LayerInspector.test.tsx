// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import {
  LayerInspector,
  selectionHeading,
} from '@/components/editor/LayerInspector'
import type { TimelineSelection } from '@/components/editor/TimelineEditor'
import { makeEditorSpec, makeSpecWithTransition } from './editorFixtures'

afterEach(cleanup)

const assetNames = { 'asset-candidate': 'Klip fixture' }

function primaryClipId(spec: ReturnType<typeof makeEditorSpec>) {
  const primary = spec.timeline.tracks.find(
    (track) => track.id === spec.timeline.primaryTrackId,
  )!
  return primary.clips[0]!.id
}

test('selectionHeading menghasilkan judul per jenis seleksi', () => {
  const spec = makeEditorSpec()
  const clipSel: TimelineSelection = {
    kind: 'clip',
    trackId: spec.timeline.primaryTrackId,
    clipId: primaryClipId(spec),
  }
  expect(selectionHeading(spec, clipSel, assetNames)).toEqual({
    title: 'Clip Â· Klip fixture',
    hint: 'Geser di canvas untuk memindah atau resize overlay.',
  })
  expect(selectionHeading(spec, null, assetNames).title).toBe('Editor')

  const transitionSpec = makeSpecWithTransition('cross-dissolve')
  expect(selectionHeading(
    transitionSpec,
    {
      kind: 'transition',
      transitionId: transitionSpec.timeline.transitions[0]!.id,
    },
    assetNames,
  ).title).toBe('Transition Â· Cross Dissolve')
})

test('header kontekstual tampil dan accordion layer settings hadir', () => {
  const spec = makeEditorSpec()
  render(
    <LayerInspector
      spec={spec}
      selected={{
        kind: 'clip',
        trackId: spec.timeline.primaryTrackId,
        clipId: primaryClipId(spec),
      }}
      assetNames={assetNames}
      onCommand={vi.fn()}
    />,
  )

  expect(screen.getByText('Clip Â· Klip fixture')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Layer settings' })).toBeVisible()
})

test('empty state menawarkan aksi cepat', async () => {
  const onSelectFirstClip = vi.fn()
  const onOpenMedia = vi.fn()
  render(
    <LayerInspector
      spec={makeEditorSpec()}
      selected={null}
      assetNames={assetNames}
      onCommand={vi.fn()}
      onSelectFirstClip={onSelectFirstClip}
      onOpenMedia={onOpenMedia}
    />,
  )

  expect(screen.getByText(/Pilih clip di timeline/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Pilih clip pertama' }))
  await userEvent.click(screen.getByRole('button', { name: 'Buka Media' }))
  expect(onSelectFirstClip).toHaveBeenCalledOnce()
  expect(onOpenMedia).toHaveBeenCalledOnce()
})

test('seleksi track membuka accordion layer settings secara default', () => {
  const spec = makeEditorSpec()
  render(
    <LayerInspector
      spec={spec}
      selected={{ kind: 'track', trackId: spec.timeline.primaryTrackId }}
      assetNames={assetNames}
      onCommand={vi.fn()}
    />,
  )

  // Nama track video dari fixture â€” verifikasi dulu nama aslinya:
  // lihat output `makeEditorSpec()` di packages/engine (createDefaultEditSpecV3).
  const primaryName = spec.timeline.tracks.find(
    (track) => track.id === spec.timeline.primaryTrackId,
  )!.name
  expect(screen.getByText(`Track Â· ${primaryName}`)).toBeVisible()
  expect(screen.getByLabelText('Nama layer')).toBeVisible()
})
