/**
 * The Quick Add text field: a `rich-textarea` whose overlay live-highlights each parsed token
 * (click a token to detokenize it) and whose keyboard pipeline defers to the sigil autocomplete
 * before handling Enter / Cmd+Enter / Escape. The parent owns the text; this component owns caret
 * restoration for both autocomplete inserts and imperative chip edits.
 */
import type { QuickAddToken } from '@opendoist/core'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { RichTextarea, type RichTextareaHandle } from 'rich-textarea'
import { cn } from '@/lib/utils'
import { type AutocompleteResources, useAutocomplete } from './autocomplete'

/** token kind → the CSS custom property tinting its highlight (18% mix over the canvas) */
function tokenColorVar(token: QuickAddToken): string {
  switch (token.kind) {
    case 'due':
    case 'duration':
      return '--od-date-today'
    case 'deadline':
      return '--od-date-overdue'
    case 'reminder':
      return '--od-warning'
    case 'project':
    case 'section':
      return '--od-accent'
    case 'label':
      return '--od-info'
    case 'priority': {
      const digit = /([1-4])/.exec(token.text)?.[1] ?? '4'
      return `--od-p${digit}`
    }
    default:
      return '--od-text-tertiary'
  }
}

function renderOverlay(
  value: string,
  activeTokens: readonly QuickAddToken[],
  onIgnore: (token: QuickAddToken) => void,
): ReactNode {
  const nodes: ReactNode[] = []
  let pos = 0
  for (const token of activeTokens) {
    if (token.start > pos) {
      nodes.push(<span key={`plain-${pos}`}>{value.slice(pos, token.start)}</span>)
    }
    nodes.push(
      // biome-ignore lint/a11y/useKeyWithClickEvents: overlay tokens are click-to-detokenize; keyboard users edit the raw text or use the chip row
      // biome-ignore lint/a11y/noStaticElementInteractions: the highlight span must stay inline to stay aligned with the textarea glyphs
      <span
        key={`tok-${token.start}-${token.kind}`}
        data-kind={token.kind}
        title="Click to remove"
        onClick={() => onIgnore(token)}
        style={{
          background: `color-mix(in srgb, var(${tokenColorVar(token)}) 18%, transparent)`,
          borderRadius: '3px',
          cursor: 'pointer',
        }}
      >
        {value.slice(token.start, token.end)}
      </span>,
    )
    pos = token.end
  }
  if (pos < value.length) nodes.push(<span key={`plain-${pos}`}>{value.slice(pos)}</span>)
  return nodes
}

export interface QuickAddInputHandle {
  focus: () => void
  /** replace the whole value and place the caret (defaults to end), keeping focus */
  setValueWithCaret: (text: string, caret?: number) => void
}

export interface QuickAddInputProps {
  value: string
  onChange: (text: string) => void
  activeTokens: QuickAddToken[]
  /** name of the parsed `#project`, used to scope `/section` autocomplete */
  projectContext: string | null
  resources: AutocompleteResources
  onIgnoreToken: (token: QuickAddToken) => void
  onEnter: () => void
  onCmdEnter: () => void
  onEscape: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  handleRef?: Ref<QuickAddInputHandle>
}

export function QuickAddInput({
  value,
  onChange,
  activeTokens,
  projectContext,
  resources,
  onIgnoreToken,
  onEnter,
  onCmdEnter,
  onEscape,
  placeholder = 'Task name',
  autoFocus = false,
  className,
  handleRef,
}: QuickAddInputProps) {
  const ref = useRef<RichTextareaHandle | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState(0)
  const [caretCoords, setCaretCoords] = useState<{
    top: number
    left: number
    height: number
  } | null>(null)

  const commit = (text: string, nextCaret: number): void => {
    pendingCaret.current = nextCaret
    onChange(text)
  }

  const autocomplete = useAutocomplete({
    text: value,
    caret,
    caretCoords,
    projectContext,
    resources,
    insert: (start, end, replacement) => {
      commit(value.slice(0, start) + replacement + value.slice(end), start + replacement.length)
    },
  })

  useImperativeHandle(handleRef, () => ({
    focus: () => ref.current?.focus(),
    setValueWithCaret: (text, nextCaret) => commit(text, nextCaret ?? text.length),
  }))

  // Apply a pending caret once the controlled value has flushed to the DOM.
  useLayoutEffect(() => {
    const target = pendingCaret.current
    if (target === null) return
    pendingCaret.current = null
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(target, target)
    setCaret(target)
  }, [value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (autocomplete.handleKeyDown(event)) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) onCmdEnter()
      else onEnter()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    }
  }

  return (
    <div className="relative">
      <RichTextarea
        ref={ref}
        value={value}
        rows={1}
        autoHeight
        placeholder={placeholder}
        spellCheck={false}
        aria-label="Quick add task"
        style={{ width: '100%' }}
        className={cn(
          'block w-full resize-none bg-transparent text-subtitle text-text-primary outline-none placeholder:text-text-tertiary',
          className,
        )}
        onChange={(event) => {
          onChange(event.target.value)
          setCaret(event.target.selectionStart ?? event.target.value.length)
        }}
        onSelectionChange={(pos) => {
          setCaret(pos.selectionStart)
          setCaretCoords(
            pos.focused && pos.selectionStart === pos.selectionEnd
              ? { top: pos.top, left: pos.left, height: pos.height }
              : null,
          )
        }}
        onKeyDown={handleKeyDown}
      >
        {(v) => renderOverlay(v, activeTokens, onIgnoreToken)}
      </RichTextarea>
      {autocomplete.node}
    </div>
  )
}
