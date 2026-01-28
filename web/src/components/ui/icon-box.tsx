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
    blue: 'bg-[oklch(0.65_0.25_285/0.2)] text-[oklch(0.65_0.25_285)]',
    cyan: 'bg-[oklch(0.75_0.25_200/0.2)] text-[oklch(0.75_0.25_200)]',
    primary: 'bg-[oklch(0.65_0.25_285/0.1)] text-[oklch(0.65_0.25_285)]'
  }

  return (
    <div className={`p-1.5 rounded-lg transition-all duration-300 hover:scale-110 hover:shadow-lg ${variantClasses[variant]} ${className}`}>
      <Icon className={sizeClasses[size]} />
    </div>
  )
}
