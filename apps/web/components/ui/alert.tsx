import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const alertVariants = cva('relative rounded-lg border px-4 py-3 text-sm leading-6', {
  variants: {
    tone: {
      neutral: 'border-border bg-surface-raised text-foreground',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      danger: 'border-danger/30 bg-danger/10 text-danger',
      success: 'border-primary/30 bg-primary/10 text-primary',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, tone, ...props }, ref) => (
    <div ref={ref} className={cn(alertVariants({ tone }), className)} {...props} />
  ),
)
Alert.displayName = 'Alert'

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn('mb-1 font-bold', className)} {...props} />
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('opacity-90', className)} {...props} />
}
