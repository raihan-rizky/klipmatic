'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
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
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { requestDeleteKey } from '@/lib/apiKeyForm'

export function DeleteApiKeyButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function remove() {
    setBusy(true)
    setError(null)
    const result = await requestDeleteKey(id)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Hapus key ${label}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus “{label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Secret tidak dapat dipulihkan. Kamu perlu membuat key baru di provider jika
              ingin menggunakannya lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => {
              event.preventDefault()
              void remove()
            }}>
              {busy ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  Menghapus…
                </>
              ) : (
                'Hapus permanen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
    </div>
  )
}
