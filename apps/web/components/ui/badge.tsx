import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em]',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-primary',
        muted: 'border-border bg-surface-soft text-muted',
        score: 'border-primary/30 bg-primary text-primary-foreground',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-danger/30 bg-danger/10 text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
