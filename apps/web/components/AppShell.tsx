import Link from 'next/link'
import { Clapperboard, KeyRound, Plus, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={250}>
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground transition focus:translate-y-0"
      >
        Langsung ke konten
      </a>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="CheapClipper — Beranda"
            className="flex min-h-11 items-center gap-2 rounded-xl font-black tracking-[-0.04em] outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Clapperboard className="size-5" aria-hidden="true" />
            </span>
            <span className="hidden text-lg min-[420px]:inline">CheapClipper</span>
          </Link>

          <nav
            aria-label="Navigasi utama"
            className="ml-auto flex items-center gap-1 sm:gap-2"
          >
            <Button asChild variant="ghost" size="sm">
              <Link href="/" aria-label="Buat klip">
                <Plus className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Buat klip</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings/keys" aria-label="API Key">
                <KeyRound className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">API Key</span>
              </Link>
            </Button>
            <Button asChild variant="secondary" size="icon">
              <Link href="/login" aria-label="Akun">
                <UserRound className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto min-h-[calc(100vh-65px)] w-full max-w-[1440px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8"
      >
        {children}
      </main>
    </TooltipProvider>
  )
}
