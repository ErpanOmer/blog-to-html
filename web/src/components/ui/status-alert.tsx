import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from './alert'

interface StatusAlertProps {
  variant: 'error' | 'info' | 'success' | 'warning' | 'cyan'
  title?: string
  children: ReactNode
  className?: string
}

export function StatusAlert({ variant, title, children, className = '' }: StatusAlertProps) {
  const variantClasses = {
    error: 'status-alert-error',
    info: 'status-alert-info',
    success: 'status-alert-success',
    warning: 'status-alert-warning',
    cyan: 'status-alert-cyan'
  }

  return (
    <Alert className={`status-alert ${variantClasses[variant]} ${className}`}>
      <div className="flex w-full flex-col gap-1">
        {title && <AlertTitle className="text-sm font-bold tracking-tight">{title}</AlertTitle>}
        <AlertDescription className="text-sm opacity-90">{children}</AlertDescription>
      </div>
    </Alert>
  )
}
