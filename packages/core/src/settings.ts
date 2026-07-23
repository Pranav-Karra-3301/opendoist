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

/** Independent light/dark/system control (the appearance×accent model, plan Task C). */
export const APPEARANCE_VALUES = ['light', 'dark', 'system'] as const
export const AppearanceSchema = z.enum(APPEARANCE_VALUES)
export type Appearance = z.infer<typeof AppearanceSchema>

/**
 * Accent palette — the seven light-scheme accents. Each gains a dark variant in tokens.css so
 * the accent applies in BOTH light and dark. This is exactly `THEME_NAMES` minus `dark` (which
 * is now an appearance, not an accent).
 */
export const ACCENT_NAMES = [
  'kale',
  'todoist',
  'moonstone',
  'tangerine',
  'blueberry',
  'lavender',
  'raspberry',
] as const
export const AccentSchema = z.enum(ACCENT_NAMES)
export type AccentName = z.infer<typeof AccentSchema>

/**
 * Back-compat migration for the pre-appearance theme model. Old settings stored `theme`
 * (one of eight, where `dark` WAS the dark scheme) + `autoDark`; the new model splits those
 * into an independent `appearance` (light/dark/system) and `accent` (palette). Map:
 *  - `autoDark: true` → appearance `system` (OS decides light/dark), accent = the base accent
 *  - `theme: 'dark'`  → appearance `dark`,  accent `kale` (old Dark had no accent axis)
 *  - a light accent   → appearance `light`, accent = that theme
 * Pure — unit-tested; used at every settings-read boundary so old rows never lose data.
 */
export function migrateThemeToAppearance(
  theme: ThemeName,
  autoDark: boolean,
): { appearance: Appearance; accent: AccentName } {
  const accent: AccentName = theme === 'dark' ? 'kale' : theme
  if (autoDark) return { appearance: 'system', accent }
  if (theme === 'dark') return { appearance: 'dark', accent: 'kale' }
  return { appearance: 'light', accent: theme }
}

/**
 * How a view renders its tasks. `list` is the shipped default; `board` is the Todoist-parity
 * kanban renderer (Board View pass). `calendar` stays a non-goal (disabled + "Soon" in the
 * Display menu), so it is intentionally NOT part of this enum. Back-compat: the field carries a
 * zod default of `list`, so any stored `viewPrefs` row written before this field existed parses
 * with `layout: 'list'` and needs no migration.
 */
export const ViewLayoutSchema = z.enum(['list', 'board'])
export type ViewLayout = z.infer<typeof ViewLayoutSchema>

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
  /** Renderer choice (list | board). A renderer detail, NOT a pipeline deviation: it never
   *  changes grouping/sorting/filtering or the section/dnd rendering the pipeline drives. */
  layout: ViewLayoutSchema.default('list'),
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
  /** New appearance×accent model (plan Task C). Both are OPTIONAL so a pre-migration row
   *  (only `theme`/`autoDark`) parses without loss — `resolveAppearance`/`resolveAccent`
   *  derive them from `theme`/`autoDark` when absent. Once written, they are authoritative. */
  appearance: AppearanceSchema.optional(),
  accent: AccentSchema.optional(),
  /** Tiny synthesized interaction sounds (task complete, quick add, toggles, …). */
  soundCues: z.boolean().default(true),
  dailyGoal: z.number().int().min(0).max(100).default(5),
  weeklyGoal: z.number().int().min(0).max(700).default(25),
  daysOff: z.array(WeekdaySchema).default([6, 7]),
  vacationMode: z.boolean().default(false),
  karmaEnabled: z.boolean().default(true),
  /** Optional heads-up minutes before a timed due. The at-time automatic reminder is always
   *  materialized server-side; null = no extra heads-up, 0 = legacy value equivalent to null. */
  autoReminderMinutes: z.number().int().min(0).max(10080).nullable().default(30),
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

/** The subset of a settings doc the appearance/accent resolvers read. `theme`/`autoDark` are
 *  optional so a new-model patch (only `appearance`/`accent`) resolves too; they fall back to the
 *  legacy defaults (`kale` + Auto Dark) when a doc carries neither axis. */
export type ThemeReadable = {
  appearance?: Appearance
  accent?: AccentName
  theme?: ThemeName
  autoDark?: boolean
}

/**
 * Effective appearance for a settings doc: the stored `appearance` when present, else migrated
 * from the legacy `theme`/`autoDark` (old rows). Read this instead of `settings.appearance`.
 */
export function resolveAppearance(s: ThemeReadable): Appearance {
  return s.appearance ?? migrateThemeToAppearance(s.theme ?? 'kale', s.autoDark ?? true).appearance
}

/**
 * Effective accent for a settings doc: the stored `accent` when present, else migrated from the
 * legacy `theme`/`autoDark` (old rows). Read this instead of `settings.accent`.
 */
export function resolveAccent(s: ThemeReadable): AccentName {
  return s.accent ?? migrateThemeToAppearance(s.theme ?? 'kale', s.autoDark ?? true).accent
}
