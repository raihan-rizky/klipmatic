import { AlertTriangle, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StatePanelProps = {
  tone?: 'neutral' | 'warning' | 'danger'
  title: string
  description: string
  action?: React.ReactNode
  busy?: boolean
  className?: string
}

const toneClass = {
  neutral: 'border-border',
  warning: 'border-warning/30',
  danger: 'border-danger/30',
}

export function StatePanel({
  tone = 'neutral',
  title,
  description,
  action,
  busy = false,
  className,
}: StatePanelProps) {
  const Icon = busy
    ? LoaderCircle
    : tone === 'danger'
      ? CircleAlert
      : tone === 'warning'
        ? AlertTriangle
        : Sparkles

  return (
    <Card
      role={tone === 'danger' ? 'alert' : busy ? 'status' : undefined}
      className={cn('mx-auto w-full max-w-2xl', toneClass[tone], className)}
    >
      <CardContent className="flex flex-col items-start gap-5 pt-5 sm:flex-row sm:items-center sm:pt-6">
        <span
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-soft text-primary',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-danger',
          )}
        >
          <Icon className={cn('size-6', busy && 'animate-spin')} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-black tracking-[-0.025em]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardContent>
    </Card>
  )
}
