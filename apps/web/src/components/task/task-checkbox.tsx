import type { Priority } from '@opendoist/core'
import { Check } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { cn } from '@/lib/utils'

export interface TaskCheckboxProps {
  priority: Priority
  checked: boolean
  uncompletable: boolean
  onToggle: () => void
  /** Task content appended to the accessible name: "Complete task: {content}". */
  content?: string
}

/**
 * 18px priority-colored circle in a 24px hit area (dossier §2.3). P1–P3 carry a 2px
 * border plus a 10%→20% priority fill and a hover check-glyph preview; P4 is a bare 1px
 * grey ring. Completing plays the 250ms `od-check` scale animation, then fires `onToggle`
 * on animation end so the row's optimistic close lands after the gesture reads. An
 * uncompletable task renders a static 6px dot instead of a checkbox. `data-priority` is a
 * frozen Playwright hook.
 */
export function TaskCheckbox({
  priority,
  checked,
  uncompletable,
  onToggle,
  content,
}: TaskCheckboxProps) {
  const [completing, setCompleting] = useState(false)
  const color = `var(--od-p${priority})`

  if (uncompletable) {
    return (
      <span
        data-priority={priority}
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center"
      >
        <span className="size-1.5 rounded-full bg-text-tertiary" />
      </span>
    )
  }

  function handleClick(event: MouseEvent) {
    event.stopPropagation()
    if (checked) {
      onToggle()
      return
    }
    setCompleting(true)
  }

  function handleAnimationEnd() {
    if (!completing) return
    setCompleting(false)
    onToggle()
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: frozen Task E contract — an animated priority-colored circle can't be a native <input type="checkbox">; role + aria-checked + data-priority form the asserted custom-widget.
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={content === undefined ? 'Complete task' : `Complete task: ${content}`}
      data-priority={priority}
      onClick={handleClick}
      onAnimationEnd={handleAnimationEnd}
      className="group/checkbox flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--od-focus-ring)]"
    >
      <span
        className={cn(
          'relative flex size-[18px] items-center justify-center overflow-hidden rounded-full',
          completing && 'animate-[od-check_250ms_linear]',
        )}
        style={{
          border: `${priority === 4 ? 1 : 2}px solid ${color}`,
          backgroundColor: checked ? color : 'transparent',
        }}
      >
        {priority !== 4 && !checked && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full opacity-10 transition-opacity duration-150 ease-in group-hover/checkbox:opacity-20"
            style={{ backgroundColor: color }}
          />
        )}
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className={cn(
            'relative size-3',
            checked
              ? 'text-white opacity-100'
              : 'opacity-0 transition-opacity duration-150 ease-in group-hover/checkbox:opacity-100',
          )}
          style={checked ? undefined : { color }}
        />
      </span>
    </button>
  )
}
