/**
 * User-settings document — FROZEN phase-5 contract (plan Task A Step 1).
 * BYTE-COMPATIBLE with phase 3's canonical camelCase `SettingsSchema`
 * (apps/server/src/api/schemas.ts): same keys, enums, defaults. Task B switches the
 * server to import this schema; web and server share this one definition.
 */
import { z } from 'zod'
import { PrioritySchema, WeekdaySchema } from './types'

export const THEME_NAMES = [
  'kale',
  'todoist',
  'dark',
  'moonstone',
  'tangerine',
  'blueberry',
  'lavender',
  'raspberry',
] as const
export const ThemeNameSchema = z.enum(THEME_NAMES)
export type ThemeName = z.infer<typeof ThemeNameSchema>

export const ViewGroupBySchema = z.enum(['none', 'project', 'priority', 'label', 'date'])
export type ViewGroupBy = z.infer<typeof ViewGroupBySchema>
export const ViewSortBySchema = z.enum(['manual', 'date', 'added', 'priority', 'alphabetical'])
export type ViewSortBy = z.infer<typeof ViewSortBySchema>

export const ViewFilterBySchema = z.object({
  priority: PrioritySchema.nullable().default(null),
  /** label NAME (labels are unique by name) */
  label: z.string().nullable().default(null),
  due: z.enum(['has-date', 'no-date', 'overdue']).nullable().default(null),
})
export type ViewFilterBy = z.infer<typeof ViewFilterBySchema>

export const ViewPrefsSchema = z.object({
  groupBy: ViewGroupBySchema.default('none'),
  sortBy: ViewSortBySchema.default('manual'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  filterBy: ViewFilterBySchema.default({ priority: null, label: null, due: null }),
  showCompleted: z.boolean().default(false),
})
export type ViewPrefs = z.infer<typeof ViewPrefsSchema>
export const DEFAULT_VIEW_PREFS: ViewPrefs = ViewPrefsSchema.parse({})

export type ViewKind = 'inbox' | 'today' | 'upcoming' | 'project' | 'label' | 'filter'
/** canonical key into UserSettings.viewPrefs, e.g. 'today', 'project:abc123' */
export function viewKey(kind: ViewKind, id?: string): string {
  return id ? `${kind}:${id}` : kind
}

export const QUICK_ADD_CHIP_IDS = [
  'date',
  'deadline',
  'priority',
  'reminders',
  'labels',
  'duration',
  'description',
] as const
export const QuickAddChipIdSchema = z.enum(QUICK_ADD_CHIP_IDS)
export type QuickAddChipId = z.infer<typeof QuickAddChipIdSchema>
export const QuickAddPrefsSchema = z.object({
  /** full ordered list; hidden chips stay reachable via the composer's overflow menu */
  chips: z
    .array(z.object({ id: QuickAddChipIdSchema, visible: z.boolean() }))
    .default(QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true }))),
  /** true = icon + text label, false = icons only */
  labeled: z.boolean().default(true),
})
export type QuickAddPrefs = z.infer<typeof QuickAddPrefsSchema>

export const SidebarPrefsSchema = z.object({
  showInbox: z.boolean().default(true),
  showToday: z.boolean().default(true),
  showUpcoming: z.boolean().default(true),
  showFiltersLabels: z.boolean().default(true),
  showReporting: z.boolean().default(true),
  showCounts: z.boolean().default(true),
})
export type SidebarPrefs = z.infer<typeof SidebarPrefsSchema>

export const NotificationTogglesSchema = z.object({
  push: z.boolean().default(true),
  ntfy: z.boolean().default(false),
  gotify: z.boolean().default(false),
  webhook: z.boolean().default(false),
})
export type NotificationToggles = z.infer<typeof NotificationTogglesSchema>

export const UserSettingsSchema = z.object({
  /** 'inbox' | 'today' | 'upcoming' | 'filters-labels' | 'project:<id>' | 'label:<id>' | 'filter:<id>' */
  homeView: z.string().default('today'),
  timezone: z.string().default('UTC'),
  dateFormat: z.enum(['MDY', 'DMY']).default('MDY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStart: WeekdaySchema.default(1),
  nextWeekDay: WeekdaySchema.default(1),
  weekendDay: WeekdaySchema.default(6),
  smartDate: z.boolean().default(true),
  theme: ThemeNameSchema.default('kale'),
  autoDark: z.boolean().default(true),
  dailyGoal: z.number().int().min(0).max(100).default(5),
  weeklyGoal: z.number().int().min(0).max(700).default(25),
  daysOff: z.array(WeekdaySchema).default([6, 7]),
  vacationMode: z.boolean().default(false),
  karmaEnabled: z.boolean().default(true),
  /** minutes before a timed due for the automatic reminder; 0 = at due time; null = off */
  autoReminderMinutes: z.number().int().min(0).max(10080).nullable().default(0),
  notifications: NotificationTogglesSchema.default({
    push: true,
    ntfy: false,
    gotify: false,
    webhook: false,
  }),
  sidebar: SidebarPrefsSchema.default({
    showInbox: true,
    showToday: true,
    showUpcoming: true,
    showFiltersLabels: true,
    showReporting: true,
    showCounts: true,
  }),
  quickAdd: QuickAddPrefsSchema.default({
    chips: QUICK_ADD_CHIP_IDS.map((id) => ({ id, visible: true })),
    labeled: true,
  }),
  /** keyed by viewKey(); PATCH semantics: shallow merge at top level, per-key replace inside viewPrefs */
  viewPrefs: z.record(z.string(), ViewPrefsSchema).default({}),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>
export const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({})
export const UserSettingsPatchSchema = UserSettingsSchema.partial()
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>
