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
      <div className="flex flex-col gap-1 w-full">
        {title && <AlertTitle className="text-base font-black">{title}</AlertTitle>}
        <AlertDescription className="text-base opacity-90">{children}</AlertDescription>
      </div>
    </Alert>
  )
}
