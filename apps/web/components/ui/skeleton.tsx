import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('studio-pulse rounded-lg bg-surface-soft', className)} {...props} />
}
