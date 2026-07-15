import { Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ModelProfile } from './types'

type ModelSelectorProps = {
  profiles: ModelProfile[]
  activeProfile: ModelProfile | null
  disabled?: boolean
  onProfileChange: (id: string) => void
  onModelChange: (model: string) => void
  onOpenSettings: () => void
}

export function ModelSelector({
  profiles,
  activeProfile,
  disabled,
  onProfileChange,
  onModelChange,
  onOpenSettings,
}: ModelSelectorProps) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      <Select value={activeProfile?.id || ''} onValueChange={onProfileChange} disabled={disabled || profiles.length === 0}>
        <SelectTrigger className="w-full bg-white/50 dark:bg-white/5 sm:w-[190px]">
          <SelectValue placeholder="选择配置" />
        </SelectTrigger>
        <SelectContent className="z-[150]">
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={activeProfile?.selectedModel || ''}
        onValueChange={onModelChange}
        disabled={disabled || !activeProfile || activeProfile.models.length === 0}
      >
        <SelectTrigger className="w-full bg-white/50 dark:bg-white/5 sm:w-[260px]">
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent className="z-[150]">
          {activeProfile?.models.map((model) => (
            <SelectItem key={model} value={model}>
              <span className="font-mono text-sm">{model}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button type="button" variant="outline" size="icon" onClick={onOpenSettings} disabled={disabled} title="模型设置">
        <Settings2 className="h-4 w-4" />
        <span className="sr-only">模型设置</span>
      </Button>
    </div>
  )
}
