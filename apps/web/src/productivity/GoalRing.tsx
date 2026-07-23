/**
 * GoalRing (phase 9 Task L) — a compact 40px progress ring for the productivity popover.
 * Pure hand-rolled SVG (no chart library): an accent arc over a border track with the
 * `completed/goal` fraction centred, swapped for a check mark once the goal is met. Every
 * colour is a design token, so the ring follows the active theme in light and dark.
 */
import type { ReactElement } from 'react'

const SIZE = 40
const STROKE = 4
const R = (SIZE - STROKE) / 2 // 18
const C = 2 * Math.PI * R
const CENTER = SIZE / 2

export function GoalRing({
  completed,
  goal,
  ariaLabel,
}: {
  completed: number
  goal: number
  ariaLabel?: string
}): ReactElement {
  const pct = goal > 0 ? Math.min(completed / goal, 1) : 0
  const met = goal > 0 && completed >= goal
  const frac = `${completed}/${goal}`
  // caption 12px by default; shrink only for the rare long fraction so it never overruns the ring.
  const fontSize = frac.length >= 6 ? 10 : frac.length >= 5 ? 11 : 12

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={ariaLabel ?? `${completed} of ${goal} completed`}
      className="block shrink-0"
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R}
        fill="none"
        stroke="var(--ot-border)"
        strokeWidth={STROKE}
      />
      {pct > 0 && (
        <circle
          cx={CENTER}
          cy={CENTER}
          r={R}
          fill="none"
          stroke="var(--ot-accent)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      )}
      {met ? (
        <path
          d="M13.5 20.5l4 4 9-9.5"
          fill="none"
          stroke="var(--ot-accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <text
          x={CENTER}
          y={CENTER}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={fontSize}
          fill="var(--ot-text-primary)"
          className="tabular-nums"
        >
          {frac}
        </text>
      )}
    </svg>
  )
}
