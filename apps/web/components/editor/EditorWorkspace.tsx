'use client'

import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
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
  inspector: ReactNode
  timeline: ReactNode
}

export function EditorWorkspace({
  header,
  preview,
  inspector,
  timeline,
}: EditorWorkspaceProps) {
  return (
    <section className="editor-workspace -mx-4 overflow-hidden border-y border-border bg-background sm:-mx-6 lg:-mx-8">
      {header}
      <div className="border-b border-border p-2 lg:hidden">
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
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
