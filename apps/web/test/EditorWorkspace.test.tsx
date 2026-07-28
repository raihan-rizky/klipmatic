// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ClipEditor } from '@/components/ClipEditor'
import {
  EditorWorkspace,
  type EditorWorkspaceProps,
} from '@/components/editor/EditorWorkspace'
import { makeReadyPayload } from './editorFixtures'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const workspaceProps: EditorWorkspaceProps = {
  header: <div>Header</div>,
  preview: <div>Preview</div>,
  inspector: <div>Inspector content</div>,
  timeline: <div>Timeline</div>,
}

test('lays out header preview inspector and timeline', () => {
  render(<EditorWorkspace {...workspaceProps} />)

  expect(screen.getByText('Header')).toBeVisible()
  expect(screen.getByText('Preview')).toBeVisible()
  expect(
    screen.getByRole('complementary', { name: 'Inspector' }),
  ).toBeVisible()
  expect(screen.getByText('Timeline')).toBeVisible()
})

test('mobile inspector opens as a sheet', async () => {
  render(<EditorWorkspace {...workspaceProps} />)

  await userEvent.click(
    screen.getByRole('button', { name: 'Buka inspector' }),
  )

  expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeVisible()
  expect(screen.getAllByText('Inspector content')).toHaveLength(2)
})

test('ready clip renders layered timeline and autosaves a split', async () => {
  const payload = makeReadyPayload()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/segment')) {
      return new Response(new Blob(['media'], { type: 'video/mp4' }))
    }
    if (url.endsWith('/api/clips/clip-1')) {
      return Response.json(payload)
    }
    return Response.json({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:clip-1'),
    revokeObjectURL: vi.fn(),
  })
  vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  vi
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined)

  render(<ClipEditor clipId="clip-1" />)

  expect(await screen.findByLabelText('Preview video vertikal')).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'Timeline editor' }),
  ).toBeVisible()
  expect(
    screen.getByRole('complementary', { name: 'Inspector' }),
  ).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Split' }))
  expect(await screen.findByText('Belum tersimpan')).toBeVisible()
  await waitFor(() => expect(screen.getByText('Tersimpan')).toBeVisible(), {
    timeout: 2500,
  })
  expect(
    fetchMock.mock.calls.some(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    ),
  ).toBe(true)
})
