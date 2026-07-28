import { Clapperboard, Link2, Sparkles } from 'lucide-react'
import { UrlForm } from '@/components/UrlForm'
import { Badge } from '@/components/ui/badge'

const STEPS = [
  {
    icon: Link2,
    step: '01',
    title: 'Tempel link',
    description: 'Masukkan video dari YouTube, TikTok, atau Google Drive.',
  },
  {
    icon: Sparkles,
    step: '02',
    title: 'AI cari highlight',
    description: 'Transkrip dan momen paling kuat dipilih otomatis.',
  },
  {
    icon: Clapperboard,
    step: '03',
    title: 'Edit & ekspor',
    description: 'Rapikan crop dan caption, lalu unduh MP4 siap posting.',
  },
]

export default function Home() {
  return (
    <div className="relative isolate overflow-hidden pb-10 sm:pb-16">
      <div
        className="pointer-events-none absolute -right-28 top-12 -z-10 size-72 rounded-full border border-primary/15 bg-primary/5 blur-3xl"
        aria-hidden="true"
      />
      <section className="mx-auto flex max-w-5xl flex-col items-center pb-16 pt-8 text-center sm:pb-24 sm:pt-16">
        <Badge className="mb-6">AI video clipper untuk creator</Badge>
        <h1 className="max-w-4xl text-balance text-4xl font-black leading-[0.98] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
          Video panjang masuk.{' '}
          <span className="text-primary">Klip siap posting keluar.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-base leading-7 text-muted sm:text-lg">
          Tempel link, biarkan AI menemukan momen terbaik, lalu edit dan ekspor langsung
          di browser.
        </p>

        <div className="mt-9 w-full max-w-3xl">
          <UrlForm />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
          <span className="mr-1 font-semibold">Sumber yang didukung</span>
          <Badge variant="muted">YouTube</Badge>
          <Badge variant="muted">TikTok</Badge>
          <Badge variant="muted">Google Drive</Badge>
        </div>
      </section>

      <section aria-labelledby="workflow-title" className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-end justify-between gap-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
              Workflow
            </p>
            <h2 id="workflow-title" className="mt-2 text-2xl font-black tracking-[-0.04em] sm:text-3xl">
              Dari link ke klip dalam tiga langkah
            </h2>
          </div>
          <p className="hidden max-w-sm text-right text-sm leading-6 text-muted md:block">
            Nggak perlu upload file besar atau pindah-pindah aplikasi.
          </p>
        </div>

        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, step, title, description }) => (
            <li
              key={step}
              className="group rounded-2xl border border-border bg-surface/75 p-5 transition hover:-translate-y-1 hover:border-primary/35 sm:p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-surface-soft text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs font-bold text-muted">{step}</span>
              </div>
              <h3 className="mt-7 text-lg font-black tracking-[-0.025em]">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
