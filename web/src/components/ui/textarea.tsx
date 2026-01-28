import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-[oklch(1_0_0/0.12)] placeholder:text-muted-foreground " +
        "focus-visible:border-[oklch(0.65_0.25_285/0.5)] " +
        "focus-visible:ring-[oklch(0.65_0.25_285/0.2)] " +
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 " +
        "aria-invalid:border-destructive " +
        "flex field-sizing-content min-h-16 w-full rounded-md " +
        "border bg-[oklch(1_0_0/0.06)] backdrop-blur-lg px-3 py-2 " +
        "text-base shadow-xs transition-all duration-300 outline-none " +
        "focus-visible:ring-[3px] hover:border-[oklch(1_0_0/0.2)] " +
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
