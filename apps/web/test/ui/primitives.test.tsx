// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

describe('UI primitives', () => {
  test('button keeps a visible focus treatment and 44px target', () => {
    render(<Button>Mulai</Button>)

    expect(screen.getByRole('button', { name: 'Mulai' })).toHaveClass(
      'min-h-11',
      'focus-visible:ring-2',
    )
  })

  test('alert dialog requires an explicit destructive confirmation', () => {
    const confirm = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Hapus</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus key?</AlertDialogTitle>
            <AlertDialogDescription>Key tidak dapat dipulihkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Hapus permanen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hapus' }))
    expect(screen.getByRole('alertdialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Hapus permanen' }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  test('progress exposes its value to assistive technology', () => {
    render(<Progress value={42} aria-label="Proses video" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  test('dialog exposes an accessible title and icon close control', () => {
    render(
      <Dialog>
        <DialogTrigger>Preview candidate</DialogTrigger>
        <DialogContent>
          <DialogTitle>Candidate #1</DialogTitle>
          <DialogDescription>Hook candidate</DialogDescription>
        </DialogContent>
      </Dialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview candidate' }))
    expect(screen.getByRole('dialog', { name: 'Candidate #1' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Tutup preview' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
