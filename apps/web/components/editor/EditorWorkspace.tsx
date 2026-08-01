'use client'

import type { ReactNode } from 'react'
import { Library, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export interface EditorWorkspaceProps {
  header: ReactNode
  preview: ReactNode
  mediaLibrary: ReactNode
  inspector: ReactNode
  timeline: ReactNode
}

export function EditorWorkspace({
  header,
  preview,
  mediaLibrary,
  inspector,
  timeline,
}: EditorWorkspaceProps) {
  return (
    <section className="editor-workspace -mx-4 overflow-hidden border-y border-border bg-background sm:-mx-6 lg:-mx-8">
      {header}
      <div className="grid grid-cols-2 gap-2 border-b border-border p-2 lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="secondary" className="w-full">
              <Library className="size-4" aria-hidden="true" />
              Buka media
            </Button>
          </SheetTrigger>
          <SheetContent aria-label="Media">
            <SheetTitle className="mb-4 pr-12 text-xl font-black">
              Media
            </SheetTitle>
            {mediaLibrary}
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="secondary" className="w-full">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Buka inspector
            </Button>
          </SheetTrigger>
          <SheetContent aria-label="Inspector">
            <SheetTitle className="mb-4 pr-12 text-xl font-black">
              Inspector
            </SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      </div>
      <div className="grid min-h-0 lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        <aside
          aria-label="Media"
          className="hidden max-h-[60vh] overflow-y-auto border-r border-border bg-surface lg:block"
        >
          {mediaLibrary}
        </aside>
        {preview}
        <aside
          aria-label="Inspector"
          className="hidden max-h-[60vh] overflow-y-auto border-l border-border bg-surface lg:block"
        >
          {inspector}
        </aside>
      </div>
      {timeline}
    </section>
  )
}
