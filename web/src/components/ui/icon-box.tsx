import type { LucideIcon } from 'lucide-react'

interface IconBoxProps {
  icon: LucideIcon
  variant?: 'blue' | 'cyan' | 'primary'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function IconBox({ icon: Icon, variant = 'blue', size = 'md', className = '' }: IconBoxProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  }

  const variantClasses = {
    blue: 'icon-box-blue',
    cyan: 'icon-box-cyan',
    primary: 'icon-box-primary'
  }

  return (
    <div className={`icon-box ${variantClasses[variant]} ${className}`}>
      <Icon className={sizeClasses[size]} />
    </div>
  )
}
