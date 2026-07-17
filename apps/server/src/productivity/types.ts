/** Productivity/karma — phase 9 FROZEN contract (plan Task A Step 4). Do not edit outside Task A. */
import { z } from 'zod'

export const WeekdayNumSchema = z.number().int().min(1).max(7)
export const ProductivitySettingsSchema = z.object({
  dailyGoal: z.number().int().min(1).max(100),
  weeklyGoal: z.number().int().min(1).max(1000),
  daysOff: z.array(WeekdayNumSchema),
  vacationMode: z.boolean(),
  karmaEnabled: z.boolean(),
})
export type ProductivitySettings = z.infer<typeof ProductivitySettingsSchema>
export const DayStatDtoSchema = z.object({
  date: z.string(),
  completed: z.number().int(),
  goalMet: z.boolean(),
  dayOff: z.boolean(),
  vacation: z.boolean(),
})
export const ProductivityDtoSchema = z.object({
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
  goals: ProductivitySettingsSchema.omit({ karmaEnabled: true }),
  today: z.object({ date: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  week: z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  streaks: z.object({
    daily: z.object({ current: z.number().int(), longest: z.number().int() }),
    weekly: z.object({ current: z.number().int(), longest: z.number().int() }),
  }),
  /** last 28, oldest first */
  days: z.array(DayStatDtoSchema),
  /** last 12 */
  weeks: z.array(
    z.object({ start: z.string(), completed: z.number().int(), goalMet: z.boolean() }),
  ),
  /** last 90 days */
  karmaHistory: z.array(
    z.object({ date: z.string(), delta: z.number().int(), runningTotal: z.number().int() }),
  ),
})
