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
    lg: 'h-6 w-6',
  }

  const variantClasses = {
    blue: 'border border-[oklch(0.62_0.12_246/0.3)] bg-[oklch(0.62_0.12_246/0.1)] text-[oklch(0.55_0.12_246)]',
    cyan: 'border border-[oklch(0.74_0.11_188/0.34)] bg-[oklch(0.74_0.11_188/0.12)] text-[oklch(0.64_0.1_188)]',
    primary: 'border border-primary/35 bg-primary/10 text-primary',
  }

  return (
    <div className={`flex items-center justify-center rounded-xl p-2 transition-colors ${variantClasses[variant]} ${className}`}>
      <Icon className={sizeClasses[size]} />
    </div>
  )
}
