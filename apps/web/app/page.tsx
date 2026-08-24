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
    <div className="motion-grid pb-10 sm:pb-16">
      <section className="relative grid gap-8 overflow-hidden border-b border-border pb-10 pt-2 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end lg:pb-14 lg:pt-8">
        <span aria-hidden="true" className="motion-scan absolute inset-y-0 left-0 w-1/3 bg-primary/10 blur-sm" />
        <div className="relative z-10">
          <Badge className="motion-reveal motion-delay-1 mb-6">AI video clipper untuk creator</Badge>
          <h1 className="motion-reveal motion-delay-2 max-w-4xl text-balance text-4xl font-black leading-none tracking-normal sm:text-6xl lg:text-7xl">
            Video panjang masuk.
            <span className="block text-primary">Klip siap posting keluar.</span>
          </h1>
          <p className="motion-reveal motion-delay-3 mt-6 max-w-2xl text-pretty text-base leading-7 text-muted sm:text-lg">
            Tempel link, biarkan AI menemukan momen terbaik, lalu edit dan ekspor langsung
            di browser.
          </p>
        </div>

        <aside
          aria-label="Clip intake desk"
          className="motion-intake relative z-10 overflow-hidden border border-border bg-surface-raised p-3 shadow-2xl shadow-black/25"
        >
          <span aria-hidden="true" className="motion-scan absolute inset-y-0 right-0 w-1/3 bg-accent/10" />
          <div className="mb-3 flex items-center justify-between border-b border-border pb-3 text-xs font-black uppercase text-muted">
            <span>Clip intake</span>
            <span className="font-mono text-primary">READY</span>
          </div>
          <div className="relative z-10">
            <UrlForm />
          </div>
          <div className="relative z-10 mt-4 grid grid-cols-3 gap-px overflow-hidden border border-border bg-border text-center text-[0.68rem] font-black uppercase text-muted">
            <span className="motion-source bg-surface px-2 py-2">YouTube</span>
            <span className="motion-source motion-delay-1 bg-surface px-2 py-2">TikTok</span>
            <span className="motion-source motion-delay-2 bg-surface px-2 py-2">Drive</span>
          </div>
        </aside>
      </section>

      <section aria-labelledby="workflow-title" className="mx-auto mt-10 max-w-6xl">
        <div className="mb-6 flex items-end justify-between gap-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
              Workflow
            </p>
            <h2 id="workflow-title" className="mt-2 text-2xl font-black tracking-normal sm:text-3xl">
              Dari link ke klip dalam tiga langkah
            </h2>
          </div>
          <p className="hidden max-w-sm text-right text-sm leading-6 text-muted md:block">
            Nggak perlu upload file besar atau pindah-pindah aplikasi.
          </p>
        </div>

        <ol className="relative grid border border-border md:grid-cols-3">
          <span aria-hidden="true" className="motion-signal pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-primary/5" />
          {STEPS.map(({ icon: Icon, step, title, description }) => (
            <li
              key={step}
              className={`motion-workflow-cell group relative z-10 border-b border-border bg-surface/75 p-5 transition hover:bg-surface-raised md:border-b-0 md:border-r md:last:border-r-0 sm:p-6 motion-delay-${step.slice(-1)}`}
            >
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-lg bg-surface-soft text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs font-bold text-muted">{step}</span>
              </div>
              <h3 className="mt-7 text-lg font-black tracking-normal">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
