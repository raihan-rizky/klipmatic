import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold tracking-[-0.01em] transition duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary:
          'border border-border bg-surface-raised text-foreground hover:border-primary/50 hover:bg-surface-soft',
        ghost: 'bg-transparent text-muted hover:bg-surface-raised hover:text-foreground',
        destructive: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        default: 'min-h-11 px-5 py-2.5',
        sm: 'min-h-11 px-3 py-2 text-sm',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, variant, size, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
