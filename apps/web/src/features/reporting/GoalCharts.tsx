/**
 * Reporting → Goals (phase 9 Task M). Three hand-rolled SVG charts over
 * GET /api/v1/productivity — no chart library: geometry comes from `chart-scale.ts`,
 * every colour from a design token. Renders a 14-day completions bar chart, a 12-week
 * bar chart, and a 90-day karma sparkline (hidden when karma is disabled).
 *
 * Shares the ['productivity'] query cache with the productivity popover (Task L). Both
 * parse the FULL ProductivityDto (mirrors apps/server/src/productivity/types.ts, frozen
 * by Task A) so whichever consumer mounts first leaves a complete cache entry.
 */
import { isoWeekday } from '@opendoist/core'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { type ApiError, api } from '@/api/client'
import { Skeleton } from '@/components/ui/skeleton'
import { barLayout, niceMax } from './chart-scale'

const DayStatSchema = z.object({
  date: z.string(),
  completed: z.number().int(),
  goalMet: z.boolean(),
  dayOff: z.boolean(),
  vacation: z.boolean(),
})
type DayStat = z.infer<typeof DayStatSchema>
const WeekStatSchema = z.object({
  start: z.string(),
  completed: z.number().int(),
  goalMet: z.boolean(),
})
const ProductivityDtoSchema = z.object({
  karmaEnabled: z.boolean(),
  karma: z.object({
    total: z.number().int(),
    level: z.object({
      name: z.string(),
      floor: z.number(),
      nextFloor: z.number().nullable(),
      progress: z.number(),
    }),
    trend: z.enum(['up', 'down', 'flat']),
  }),
  goals: z.object({
    dailyGoal: z.number().int(),
    weeklyGoal: z.number().int(),
    daysOff: z.array(z.number().int()),
    vacationMode: z.boolean(),
  }),
  today: z.object({ date: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  week: z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  streaks: z.object({
    daily: z.object({ current: z.number().int(), longest: z.number().int() }),
    weekly: z.object({ current: z.number().int(), longest: z.number().int() }),
  }),
  days: z.array(DayStatSchema),
  weeks: z.array(WeekStatSchema),
  karmaHistory: z.array(
    z.object({ date: z.string(), delta: z.number().int(), runningTotal: z.number().int() }),
  ),
})
type ProductivityDto = z.infer<typeof ProductivityDtoSchema>

function useProductivity() {
  return useQuery<ProductivityDto, ApiError>({
    queryKey: ['productivity'],
    queryFn: () => api('/productivity', { schema: ProductivityDtoSchema }),
  })
}

/* ---------- date labels (pure string parsing on calendar dates, no Date math) ---------- */

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** ISO-weekday initial (Mon→'M' … Sun→'S') of a YYYY-MM-DD date. */
function weekdayInitial(dateIso: string): string {
  return WEEKDAY_INITIALS[isoWeekday(dateIso) - 1] ?? ''
}

/** 'YYYY-MM-DD' → 'Jul 14'. */
function monthDay(dateIso: string): string {
  const parts = dateIso.split('-')
  const month = parts[1]
  const day = parts[2]
  if (month === undefined || day === undefined) return dateIso
  const monthName = MONTHS[Number.parseInt(month, 10) - 1] ?? month
  return `${monthName} ${Number.parseInt(day, 10)}`
}

function dayNote(day: DayStat): string {
  if (day.vacation) return ' · vacation'
  if (day.dayOff) return ' · day off'
  return ''
}

/* ---------- bar chart ---------- */

interface Bar {
  /** doubles as the react key */
  key: string
  value: number
  /** rendered at 40% opacity (day off / vacation) */
  muted: boolean
  /** today (daily) or the current week (weekly) — soft accent backdrop + bold label */
  highlight: boolean
  label: string
  tooltip: string
}

const TOP = 18
const PLOT_H = 132
const BOTTOM = 22
const GAP = 6

function BarChart({
  bars,
  goal,
  goalLabel,
  colWidth,
  ariaLabel,
}: {
  bars: Bar[]
  goal: number
  goalLabel: string
  colWidth: number
  ariaLabel: string
}) {
  const height = TOP + PLOT_H + BOTTOM
  const plotW = Math.max(bars.length * colWidth, colWidth)
  const axisMax = niceMax(
    bars.map((b) => b.value),
    goal,
  )
  const cols = barLayout(bars.length, plotW, GAP)
  const goalY = TOP + PLOT_H * (1 - goal / axisMax)
  const baseline = TOP + PLOT_H

  return (
    <div className="overflow-x-auto">
      <svg width={plotW} height={height} className="block">
        <title>{ariaLabel}</title>
        {/* baseline */}
        <line
          x1={0}
          x2={plotW}
          y1={baseline}
          y2={baseline}
          stroke="var(--od-border)"
          strokeWidth={1}
        />
        {/* goal line + label */}
        <line
          x1={0}
          x2={plotW}
          y1={goalY}
          y2={goalY}
          stroke="var(--od-text-tertiary)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text
          x={plotW}
          y={Math.max(goalY - 4, 10)}
          textAnchor="end"
          fontSize={11}
          fill="var(--od-text-tertiary)"
        >
          {goalLabel}
        </text>
        {bars.map((bar, i) => {
          const col = cols[i]
          if (col === undefined) return null
          const top = TOP + PLOT_H * (1 - bar.value / axisMax)
          const cx = col.x + col.w / 2
          return (
            <g key={bar.key}>
              {bar.highlight && (
                <rect
                  x={col.x - GAP / 2}
                  y={TOP}
                  width={col.w + GAP}
                  height={PLOT_H}
                  rx={3}
                  fill="var(--od-accent-soft)"
                />
              )}
              {/* full-height hover target so zero-completion days still show a tooltip */}
              <rect x={col.x} y={TOP} width={col.w} height={PLOT_H} fill="transparent">
                <title>{bar.tooltip}</title>
              </rect>
              {bar.value > 0 && (
                <rect
                  x={col.x}
                  y={top}
                  width={col.w}
                  height={Math.max(baseline - top, 2)}
                  rx={3}
                  fill="var(--od-accent)"
                  opacity={bar.muted ? 0.4 : 1}
                >
                  <title>{bar.tooltip}</title>
                </rect>
              )}
              <text
                x={cx}
                y={height - 7}
                textAnchor="middle"
                fontSize={11}
                fontWeight={bar.highlight ? 600 : 400}
                fill={bar.highlight ? 'var(--od-accent)' : 'var(--od-text-tertiary)'}
              >
                {bar.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---------- karma sparkline ---------- */

function KarmaSparkline({ points, ariaLabel }: { points: number[]; ariaLabel: string }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-caption text-text-tertiary">No karma history yet.</p>
  }
  const width = 640
  const height = 96
  const padY = 10
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = points.length > 1 ? width / (points.length - 1) : 0
  const coords = points
    .map((p, i) => {
      const x = i * stepX
      const y = padY + (height - 2 * padY) * (1 - (p - min) / span)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <div className="overflow-x-auto">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block"
        style={{ minWidth: 240 }}
      >
        <title>{ariaLabel}</title>
        <polyline
          points={coords}
          fill="none"
          stroke="var(--od-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

/* ---------- section frame ---------- */

function ChartSection({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-subtitle text-text-primary">{title}</h3>
        <p className="text-caption text-text-tertiary">{subtitle}</p>
      </div>
      {children}
    </section>
  )
}

/* ---------- page section ---------- */

export function GoalCharts() {
  const query = useProductivity()

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-8 py-4">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    )
  }
  if (query.isError || query.data === undefined) {
    return (
      <p className="py-16 text-center text-body text-text-tertiary">
        Couldn't load your goals. Check your connection and try again.
      </p>
    )
  }

  const data = query.data
  const dailyBars: Bar[] = data.days.slice(-14).map((day) => ({
    key: day.date,
    value: day.completed,
    muted: day.dayOff || day.vacation,
    highlight: day.date === data.today.date,
    label: weekdayInitial(day.date),
    tooltip: `${monthDay(day.date)} · ${day.completed} completed${dayNote(day)}`,
  }))
  const weekBars: Bar[] = data.weeks.slice(-12).map((wk) => ({
    key: wk.start,
    value: wk.completed,
    muted: false,
    highlight: wk.start === data.week.start,
    label: monthDay(wk.start),
    tooltip: `Week of ${monthDay(wk.start)} · ${wk.completed} completed`,
  }))
  const karmaPoints = data.karmaHistory.map((k) => k.runningTotal)

  return (
    <div className="flex flex-col gap-8 py-4">
      <ChartSection title="Daily" subtitle="Completed · last 14 days">
        <BarChart
          bars={dailyBars}
          goal={data.goals.dailyGoal}
          goalLabel={`goal ${data.goals.dailyGoal}`}
          colWidth={34}
          ariaLabel={`Tasks completed per day over the last 14 days, daily goal ${data.goals.dailyGoal}`}
        />
      </ChartSection>

      <ChartSection title="Weekly" subtitle="Completed · last 12 weeks">
        <BarChart
          bars={weekBars}
          goal={data.goals.weeklyGoal}
          goalLabel={`goal ${data.goals.weeklyGoal}`}
          colWidth={48}
          ariaLabel={`Tasks completed per week over the last 12 weeks, weekly goal ${data.goals.weeklyGoal}`}
        />
      </ChartSection>

      {data.karmaEnabled && (
        <ChartSection
          title="Karma"
          subtitle={`${data.karma.level.name} · ${data.karma.total.toLocaleString()} pts`}
        >
          <KarmaSparkline points={karmaPoints} ariaLabel="Karma points over the last 90 days" />
        </ChartSection>
      )}
    </div>
  )
}
