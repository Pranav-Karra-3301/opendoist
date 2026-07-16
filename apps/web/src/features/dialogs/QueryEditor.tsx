/**
 * `QueryEditor` (plan Task E) — a controlled, monospace filter-query input with live,
 * debounced validation over the full active-task set. On a syntax error it renders the core
 * `FilterSyntaxError` message with a caret marker under the offending column; on success it
 * renders one "Pane N · <count>" chip per comma-pane. A "Syntax help" popover lists the
 * operators and examples (dossier §1.7). The pure `computeQueryState` is exported for tests.
 */
import {
  type FilterContext,
  type FilterQuery,
  FilterSyntaxError,
  type FilterTaskView,
  filterTasks,
  parseFilter,
  splitPanesRaw,
} from '@opendoist/core'
import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface QueryPaneInfo {
  /** raw source sub-query for this pane (from `splitPanesRaw`), trimmed; '' when unavailable */
  raw: string
  /** number of active tasks the pane matches */
  count: number
}
export type QueryEditorState =
  | { status: 'empty' }
  | { status: 'error'; message: string; position: number }
  | { status: 'ok'; panes: QueryPaneInfo[] }

/**
 * Pure editor state for a raw filter query. Blank → `empty`; a `FilterSyntaxError` → its
 * message and caret `position`; otherwise `ok` with one pane per parsed comma-pane. The pane
 * count is authoritative from `filterTasks` (one array per parsed pane); each pane is labelled
 * with `splitPanesRaw`'s source string when the arrays line up.
 */
export function computeQueryState(
  query: string,
  tasks: FilterTaskView[],
  ctx: FilterContext,
): QueryEditorState {
  if (query.trim() === '') return { status: 'empty' }
  let parsed: FilterQuery
  try {
    parsed = parseFilter(query)
  } catch (error) {
    if (error instanceof FilterSyntaxError) {
      return { status: 'error', message: error.message, position: error.position }
    }
    throw error
  }
  const paneResults = filterTasks(parsed, tasks, ctx)
  const rawPanes = splitPanesRaw(query)
  return {
    status: 'ok',
    panes: paneResults.map((matched, index) => ({
      raw: (rawPanes[index] ?? '').trim(),
      count: matched.length,
    })),
  }
}

const OPERATORS: ReadonlyArray<[string, string]> = [
  ['&', 'both conditions (and)'],
  ['|', 'either condition (or)'],
  ['!', 'not'],
  ['( )', 'group conditions'],
  [',', 'split into separate panes'],
  ['\\', 'escape a literal character'],
  ['*', 'wildcard in @label / #project'],
]
const EXAMPLES: readonly string[] = [
  'today | overdue',
  '#Work & p1 & !subtask',
  '@email* & no date',
  '(today | overdue) & #Inbox, view all & !#Inbox',
]

function SyntaxHelp() {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className="cursor-pointer rounded-xs text-accent text-caption hover:underline focus-visible:outline-2 focus-visible:outline-[var(--od-focus-ring)] focus-visible:outline-offset-2"
      >
        Syntax help
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="grid gap-3 text-caption">
          <div>
            <div className="mb-1.5 font-medium text-text-primary">Operators</div>
            <dl className="grid grid-cols-[3rem_1fr] gap-x-3 gap-y-1 text-text-secondary">
              {OPERATORS.map(([symbol, meaning]) => (
                <div key={symbol} className="contents">
                  <dt className="font-mono text-text-primary">{symbol}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <div className="mb-1.5 font-medium text-text-primary">Examples</div>
            <ul className="grid gap-1 font-mono text-text-secondary">
              {EXAMPLES.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function QueryEditor({
  id = 'filter-query',
  value,
  onChange,
  tasks,
  ctx,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  tasks: FilterTaskView[]
  ctx: FilterContext
}) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 150)
    return () => clearTimeout(timer)
  }, [value])
  const state = useMemo(() => computeQueryState(debounced, tasks, ctx), [debounced, tasks, ctx])
  const errorId = `${id}-error`
  // A caret marker under the offending column; clamped into range so it never overflows.
  const caretPad =
    state.status === 'error' ? ' '.repeat(Math.max(0, Math.min(state.position, value.length))) : ''

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="font-medium text-caption text-text-secondary">
          Query
        </label>
        <SyntaxHelp />
      </div>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. (today | overdue) & #Inbox"
        className="font-mono"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // The query input keeps its grey border per the component cheatsheet; the syntax error
        // surfaces via the caret + role="alert" message below, not a red field border.
        aria-describedby={state.status === 'error' ? errorId : undefined}
      />
      {state.status === 'error' && (
        <div className="grid gap-0.5">
          <div
            aria-hidden="true"
            className="overflow-hidden whitespace-pre px-2 font-mono text-body text-danger leading-none"
          >
            {`${caretPad}^`}
          </div>
          <p id={errorId} role="alert" className="text-caption text-danger">
            {state.message}
          </p>
        </div>
      )}
      {state.status === 'ok' && (
        <div className="flex flex-wrap gap-1.5">
          {state.panes.map((pane, index) => (
            <span
              key={index}
              title={pane.raw === '' ? undefined : pane.raw}
              className="inline-flex items-center rounded-xs border border-border px-2 py-0.5 text-caption text-text-secondary"
            >
              {`Pane ${index + 1} · ${pane.count} ${pane.count === 1 ? 'task' : 'tasks'}`}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
