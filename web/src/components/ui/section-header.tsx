import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { IconBox } from './icon-box'

interface SectionHeaderProps {
  icon: LucideIcon
  title: string
  iconVariant?: 'blue' | 'cyan' | 'primary'
  actions?: ReactNode
}

export function SectionHeader({ icon, title, iconVariant = 'blue', actions }: SectionHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <IconBox icon={icon} variant={iconVariant} />
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {actions && <div className="action-bar">{actions}</div>}
    </div>
  )
}
