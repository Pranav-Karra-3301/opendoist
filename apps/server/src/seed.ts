/**
 * `pnpm seed` — demo dataset loader (Phase 10 Task J).
 *
 * Implements the FROZEN SEED DATASET (plan Task A Step 10) against a real OpenDoist database:
 * one demo user, four projects (+ two Work sections), five labels, two filters, the frozen
 * Quick Add tasks (parsed through core `parseQuickAdd`, persisted through the SAME service path
 * the `POST /tasks/quick` route uses), a small subtask tree, and six completed tasks back-dated
 * across the past five days so the activity feed and karma/day_stats rollup have history.
 *
 * Behaviour:
 *   - Reads `OPENDOIST_DATA_DIR` (via `loadConfig`) and opens the DB exactly like the server does
 *     (`openDb` runs migrations on open, so a fresh data dir is migrated automatically).
 *   - Idempotency: if any non-Inbox project already exists it prints the already-has-data line and
 *     exits 0 unless `--force` is passed. Unknown flags exit 2.
 *   - The demo user (`demo@opendoist.local` / `opendoist-demo`) is created via better-auth's
 *     server-side API only when the instance has zero users; on later runs it is reused.
 *   - `--verify` re-opens the DB and asserts the seeded counts, exiting non-zero on mismatch.
 *
 * Adaptations recorded for the integrator:
 *   - The frozen dataset writes the multi-word project as `#Reading List`, but the frozen Quick Add
 *     parser terminates `#project` names at whitespace (core `quick-add/parse.test.ts`). To land those
 *     tasks in the intended "Reading List" project the strings are quoted here as `#"Reading List"`
 *     (grammar-supported form for the same project) — this preserves the dataset's intent.
 *   - The dataset lists 18 open task strings (15 top-level + 1 uncompletable parent + 2 subtasks);
 *     the plan's Step 4 summary line reads "19 open tasks", which is an off-by-one. Counts here are
 *     derived from the dataset arrays so the printed/verified numbers are self-consistent (18 open).
 */
import { join } from 'node:path'
import {
  addDaysIso,
  dateInTz,
  instantFor,
  type ParseContext,
  parseQuickAdd,
  type ReminderDraft,
  UserSettingsSchema,
} from '@opendoist/core'
import { and, count, eq, isNotNull, isNull, max } from 'drizzle-orm'
import { createAuth } from './auth'
import { type Config, loadConfig } from './config'
import { user } from './db/auth-schema'
import { type Db, openDb } from './db/db'
import {
  activityLog,
  filters,
  labels,
  projects,
  reminders,
  sections,
  tasks,
  userSettings,
} from './db/schema'
import { logActivity } from './lib/activity'
import { newId, nowIso } from './lib/ids'
import { parseContextFor } from './lib/parse-context'
import { recordCompletion } from './productivity/rollup'
import { syncTaskReminders } from './reminders/materialize'
import { ensureDataDirAndSecrets } from './secrets'
import { resolveProject, resolveSection } from './services/quick-resolve'
import { type CreateTaskInput, createTask, getSettings } from './services/task-write'

const DEMO_EMAIL = 'demo@opendoist.local'
const DEMO_PASSWORD = 'opendoist-demo'
const DEMO_NAME = 'Demo'
/** Frozen dataset timezone — all relative dues resolve here so screenshots stay "today"-correct. */
const TZ = 'America/New_York'

/* ---------- FROZEN SEED DATASET (plan Task A Step 10) ---------- */

interface SeedProject {
  name: string
  color: string
  favorite: boolean
  sections: string[]
}

const SEED_PROJECTS: SeedProject[] = [
  { name: 'Work', color: 'blue', favorite: false, sections: ['Admin', 'Meetings'] },
  { name: 'Home', color: 'lime_green', favorite: false, sections: [] },
  { name: 'Groceries', color: 'orange', favorite: false, sections: [] },
  { name: 'Reading List', color: 'taupe', favorite: true, sections: [] },
]

const SEED_LABELS: { name: string; color: string }[] = [
  { name: 'email', color: 'red' },
  { name: 'errands', color: 'orange' },
  { name: 'deep-work', color: 'blue' },
  { name: 'waiting', color: 'grey' },
  { name: '15min', color: 'mint_green' },
]

const SEED_FILTERS: { name: string; query: string; color: string; favorite: boolean }[] = [
  { name: 'Priority focus', query: '(today | overdue) & (p1 | p2)', color: 'red', favorite: true },
  { name: 'Errands', query: '@errands & !subtask', color: 'grape', favorite: false },
]

/** Quick Add strings fed verbatim through `parseQuickAdd`. `#"Reading List"` is the grammar-quoted
 *  form of the frozen `#Reading List` (see the module docstring). */
const SEED_OPEN_TASKS: string[] = [
  'Ship weekly status update today 4pm p2 #Work /Admin @email',
  'Prepare board deck tom 10am for 45min p1 #Work /Meetings @deep-work {friday}',
  'Review pull requests every workday 9am p3 #Work',
  '1:1 with future self every mon 2pm #Work /Meetings',
  'Renew passport yesterday p1 @errands',
  'Water the plants every 3 days #Home',
  'Fix squeaky door p4 #Home @15min',
  'Deep clean kitchen this weekend #Home',
  'Milk #Groceries',
  'Eggs #Groceries',
  'Coffee beans p2 #Groceries @errands',
  'Read "The Design of Everyday Things" #"Reading List" @deep-work',
  'Call the bank tom 9am !30 min before p2 @errands',
  'Plan weekend trip next week #Home // collect ideas in comments',
  'Submit expense report {end of month} p2 #Work /Admin @waiting',
]

/** Uncompletable parent (leading `* `) plus its two subtasks (parent id passed as parent_id). */
const SEED_READING_PARENT = '* Reading queue #"Reading List"'
const SEED_READING_SUBTASKS: string[] = [
  'Article: local-first software #"Reading List"',
  'Article: SQLite as app format #"Reading List"',
]

interface SeedCompleted {
  content: string
  project: string
  /** completed this many days ago (2/1/1/1/1 across the past five days) */
  daysAgo: number
}

const SEED_COMPLETED: SeedCompleted[] = [
  { content: 'Reply to the Q2 planning thread', project: 'Work', daysAgo: 1 },
  { content: 'Submit timesheet', project: 'Work', daysAgo: 1 },
  { content: 'Vacuum the living room', project: 'Home', daysAgo: 2 },
  { content: 'Take out the recycling', project: 'Home', daysAgo: 3 },
  { content: 'Refresh the project roadmap', project: 'Work', daysAgo: 4 },
  { content: 'Book a dentist appointment', project: 'Home', daysAgo: 5 },
]

/** Counts derived from the dataset arrays so the summary line and `--verify` stay self-consistent. */
const EXPECTED = {
  projects: SEED_PROJECTS.length,
  labels: SEED_LABELS.length,
  filters: SEED_FILTERS.length,
  open: SEED_OPEN_TASKS.length + 1 + SEED_READING_SUBTASKS.length,
  completed: SEED_COMPLETED.length,
}

/* ---------- counting / lookup ---------- */

interface Counts {
  projects: number
  labels: number
  filters: number
  open: number
  completed: number
}

function countsFor(db: Db, userId: string): Counts {
  return {
    projects:
      db
        .select({ n: count() })
        .from(projects)
        .where(
          and(eq(projects.userId, userId), eq(projects.isInbox, false), isNull(projects.deletedAt)),
        )
        .get()?.n ?? 0,
    labels:
      db
        .select({ n: count() })
        .from(labels)
        .where(and(eq(labels.userId, userId), isNull(labels.deletedAt)))
        .get()?.n ?? 0,
    filters:
      db
        .select({ n: count() })
        .from(filters)
        .where(and(eq(filters.userId, userId), isNull(filters.deletedAt)))
        .get()?.n ?? 0,
    open:
      db
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), isNull(tasks.completedAt), isNull(tasks.deletedAt)))
        .get()?.n ?? 0,
    completed:
      db
        .select({ n: count() })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), isNotNull(tasks.completedAt), isNull(tasks.deletedAt)))
        .get()?.n ?? 0,
  }
}

function findDemoUserId(db: Db): string | undefined {
  return db.select({ id: user.id }).from(user).where(eq(user.email, DEMO_EMAIL)).get()?.id
}

function summary(c: Counts): string {
  return `${c.projects} projects, ${c.labels} labels, ${c.filters} filters, ${c.open} open tasks, ${c.completed} completed`
}

/* ---------- find-or-create entity helpers (case-exact by name; reuse keeps `--force` clean) ---------- */

function upsertProject(db: Db, userId: string, p: SeedProject, childOrder: number): string {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.name, p.name), isNull(projects.deletedAt)))
    .get()
  if (existing !== undefined) return existing.id
  const now = nowIso()
  const id = newId()
  db.insert(projects)
    .values({
      id,
      userId,
      name: p.name,
      color: p.color,
      childOrder,
      isFavorite: p.favorite,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  logActivity(db, {
    userId,
    eventType: 'project_added',
    entityType: 'project',
    entityId: id,
    projectId: id,
  })
  return id
}

function upsertSection(
  db: Db,
  userId: string,
  projectId: string,
  name: string,
  sectionOrder: number,
): string {
  const existing = db
    .select({ id: sections.id })
    .from(sections)
    .where(
      and(
        eq(sections.userId, userId),
        eq(sections.projectId, projectId),
        eq(sections.name, name),
        isNull(sections.deletedAt),
      ),
    )
    .get()
  if (existing !== undefined) return existing.id
  const now = nowIso()
  const id = newId()
  db.insert(sections)
    .values({ id, userId, projectId, name, sectionOrder, createdAt: now, updatedAt: now })
    .run()
  logActivity(db, {
    userId,
    eventType: 'section_added',
    entityType: 'section',
    entityId: id,
    projectId,
  })
  return id
}

function upsertLabel(
  db: Db,
  userId: string,
  l: { name: string; color: string },
  order: number,
): void {
  const existing = db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.userId, userId), eq(labels.name, l.name), isNull(labels.deletedAt)))
    .get()
  if (existing !== undefined) return
  const now = nowIso()
  const id = newId()
  db.insert(labels)
    .values({
      id,
      userId,
      name: l.name,
      color: l.color,
      itemOrder: order,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  logActivity(db, { userId, eventType: 'label_added', entityType: 'label', entityId: id })
}

function upsertFilter(
  db: Db,
  userId: string,
  f: { name: string; query: string; color: string; favorite: boolean },
  order: number,
): void {
  const existing = db
    .select({ id: filters.id })
    .from(filters)
    .where(and(eq(filters.userId, userId), eq(filters.name, f.name), isNull(filters.deletedAt)))
    .get()
  if (existing !== undefined) return
  const now = nowIso()
  const id = newId()
  db.insert(filters)
    .values({
      id,
      userId,
      name: f.name,
      query: f.query,
      color: f.color,
      itemOrder: order,
      isFavorite: f.favorite,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  logActivity(db, { userId, eventType: 'filter_added', entityType: 'filter', entityId: id })
}

/* ---------- Quick Add task creation (mirrors POST /tasks/quick) ---------- */

/** Persist the parsed `!` reminder tokens, exactly as the quick-add route does. */
function persistReminders(
  db: Db,
  userId: string,
  taskId: string,
  dueDate: string | null,
  dueTime: string | null,
  drafts: ReminderDraft[],
): void {
  const now = nowIso()
  for (const draft of drafts) {
    if (draft.kind === 'relative') {
      // A relative reminder needs a due date AND time to fire relative to (route parity).
      if (dueDate === null || dueTime === null) continue
      db.insert(reminders)
        .values({
          id: newId(),
          userId,
          taskId,
          type: 'relative',
          minuteOffset: draft.minutesBefore,
          dueJson: null,
          isAuto: false,
          fireAtUtc: null,
          firedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } else if (draft.kind === 'absolute') {
      const due = {
        date: draft.date,
        time: draft.time,
        string: `${draft.date} ${draft.time}`,
        recurrence: null,
      }
      db.insert(reminders)
        .values({
          id: newId(),
          userId,
          taskId,
          type: 'absolute',
          minuteOffset: null,
          dueJson: JSON.stringify(due),
          isAuto: false,
          fireAtUtc: null,
          firedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    } else {
      db.insert(reminders)
        .values({
          id: newId(),
          userId,
          taskId,
          type: 'recurring',
          minuteOffset: null,
          dueJson: JSON.stringify(draft.due),
          isAuto: false,
          fireAtUtc: null,
          firedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }
  }
}

/**
 * Parse `text` with core `parseQuickAdd`, resolve `#project`/`/section` via the quick-add service
 * helpers, persist through `createTask`, log the activity, persist any `!` reminders, and re-sync
 * reminders — i.e. the body of the `POST /tasks/quick` handler minus HTTP/SSE. `parentId` lets the
 * subtasks attach to their parent (the route always creates top-level, so this is a seed extension).
 */
async function quickAdd(
  db: Db,
  userId: string,
  text: string,
  ctx: ParseContext,
  parentId: string | null = null,
): Promise<string> {
  const parsed = parseQuickAdd(text, ctx)
  let projectId: string | null = null
  if (parsed.project !== null) projectId = resolveProject(db, userId, parsed.project).id
  let sectionId: string | null = null
  if (parsed.section !== null && projectId !== null) {
    sectionId = resolveSection(db, userId, projectId, parsed.section).id
  }
  const input: CreateTaskInput = {
    content: parsed.title,
    description: parsed.description ?? '',
    projectId,
    sectionId,
    parentId,
    childOrder: null,
    priority: parsed.priority,
    dueDate: parsed.due?.date ?? null,
    dueTime: parsed.due?.time ?? null,
    dueString: parsed.due?.string ?? null,
    recurrence: parsed.due?.recurrence ?? null,
    deadlineDate: parsed.deadline,
    durationMin: parsed.durationMin,
    labels: parsed.labels,
    uncompletable: parsed.uncompletable,
  }
  const row = createTask(db, userId, input)
  logActivity(db, {
    userId,
    eventType: 'task_added',
    entityType: 'task',
    entityId: row.id,
    projectId: row.projectId,
    payload: { via: 'seed' },
  })
  persistReminders(db, userId, row.id, row.dueDate, row.dueTime, parsed.reminders)
  await syncTaskReminders(db, row.id)
  return row.id
}

/**
 * Create a plain task and immediately complete it with a back-dated instant, mirroring the close
 * route's `completed_at` write + `recordCompletion` rollup, then back-date the activity row so the
 * feed and productivity charts show real history.
 */
function seedCompleted(
  db: Db,
  userId: string,
  projectId: string,
  content: string,
  completedAt: string,
): void {
  const row = createTask(db, userId, {
    content,
    description: '',
    projectId,
    sectionId: null,
    parentId: null,
    childOrder: null,
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueString: null,
    recurrence: null,
    deadlineDate: null,
    durationMin: null,
    labels: [],
    uncompletable: false,
  })
  db.update(tasks)
    .set({ completedAt, createdAt: completedAt, updatedAt: completedAt })
    .where(eq(tasks.id, row.id))
    .run()
  db.insert(activityLog)
    .values({
      id: newId(),
      userId,
      eventType: 'task_completed',
      entityType: 'task',
      entityId: row.id,
      projectId,
      payload: null,
      at: completedAt,
    })
    .run()
  recordCompletion(db, { userId, taskId: row.id, dueDate: null, completedAt })
}

/* ---------- run modes ---------- */

async function runSeed(
  db: Db,
  config: Config,
  sessionSecret: string,
  force: boolean,
): Promise<number> {
  const existingNonInbox =
    db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.isInbox, false), isNull(projects.deletedAt)))
      .get()?.n ?? 0
  if (existingNonInbox > 0 && !force) {
    console.log('seed: database already has data — pass --force to add demo data anyway')
    return 0
  }

  // Demo user via better-auth's server-side API — only when the instance has zero users.
  let userId = findDemoUserId(db)
  let userCreated = false
  if (userId === undefined) {
    const totalUsers = db.select({ n: count() }).from(user).get()?.n ?? 0
    if (totalUsers > 0) {
      console.error(
        `seed: instance has ${totalUsers} user(s) but no ${DEMO_EMAIL}; refusing to seed`,
      )
      console.error('seed: start from an empty OPENDOIST_DATA_DIR to create the demo user')
      return 1
    }
    const auth = createAuth(db, config, sessionSecret)
    await auth.api.signUpEmail({
      body: { name: DEMO_NAME, email: DEMO_EMAIL, password: DEMO_PASSWORD },
    })
    userId = findDemoUserId(db)
    if (userId === undefined) throw new Error('demo user creation did not produce a user row')
    userCreated = true
  }
  console.log(`seed: demo user ${DEMO_EMAIL} (${userCreated ? 'created' : 'reused'})`)

  // Pin the demo user's timezone so parsed dues and the app's rendering agree on "today".
  const withTz = UserSettingsSchema.parse({ ...getSettings(db, userId), timezone: TZ })
  db.update(userSettings)
    .set({ settings: JSON.stringify(withTz), updatedAt: nowIso() })
    .where(eq(userSettings.userId, userId))
    .run()

  // The exact ParseContext the /tasks/quick route builds, pinned to America/New_York; its
  // weekStart/nextWeekDay/weekendDay/smartDate are the schema defaults (= DEFAULT_PARSE_CONTEXT_SETTINGS).
  const now = nowIso()
  const ctx = parseContextFor(getSettings(db, userId), now)

  // Projects (+ Work sections).
  const baseOrder =
    db
      .select({ m: max(projects.childOrder) })
      .from(projects)
      .where(
        and(eq(projects.userId, userId), isNull(projects.parentId), isNull(projects.deletedAt)),
      )
      .get()?.m ?? -1
  const projectByName = new Map<string, string>()
  let sectionTotal = 0
  SEED_PROJECTS.forEach((p, i) => {
    const projectId = upsertProject(db, userId, p, baseOrder + 1 + i)
    projectByName.set(p.name, projectId)
    p.sections.forEach((name, si) => {
      upsertSection(db, userId, projectId, name, si)
      sectionTotal += 1
    })
  })
  console.log(`seed: ${SEED_PROJECTS.length} projects, ${sectionTotal} sections`)

  SEED_LABELS.forEach((l, i) => {
    upsertLabel(db, userId, l, i)
  })
  console.log(`seed: ${SEED_LABELS.length} labels`)

  SEED_FILTERS.forEach((f, i) => {
    upsertFilter(db, userId, f, i)
  })
  console.log(`seed: ${SEED_FILTERS.length} filters`)

  // Open tasks through the Quick Add path; parent before its subtasks.
  for (const text of SEED_OPEN_TASKS) await quickAdd(db, userId, text, ctx)
  const parentId = await quickAdd(db, userId, SEED_READING_PARENT, ctx)
  for (const text of SEED_READING_SUBTASKS) await quickAdd(db, userId, text, ctx, parentId)
  console.log(
    `seed: ${EXPECTED.open} open tasks (incl. 1 uncompletable parent + ${SEED_READING_SUBTASKS.length} subtasks)`,
  )

  // Completed history for the activity feed + karma/day_stats rollup.
  const todayNy = dateInTz(now, TZ)
  for (const t of SEED_COMPLETED) {
    const projectId = projectByName.get(t.project)
    if (projectId === undefined)
      throw new Error(`completed task references unknown project ${t.project}`)
    const completedAt = instantFor(addDaysIso(todayNy, -t.daysAgo), '12:00', TZ)
    seedCompleted(db, userId, projectId, t.content, completedAt)
  }
  console.log(`seed: ${SEED_COMPLETED.length} completed tasks`)

  console.log(`seed: done — ${summary(countsFor(db, userId))}`)
  return 0
}

function runVerify(db: Db): boolean {
  const userId = findDemoUserId(db)
  if (userId === undefined) {
    console.error(`seed: verify failed — no ${DEMO_EMAIL} user`)
    return false
  }
  const c = countsFor(db, userId)
  const checks: [string, number, number][] = [
    ['projects', c.projects, EXPECTED.projects],
    ['labels', c.labels, EXPECTED.labels],
    ['filters', c.filters, EXPECTED.filters],
    ['open tasks', c.open, EXPECTED.open],
    ['completed', c.completed, EXPECTED.completed],
  ]
  const bad = checks.filter(([, got, want]) => got !== want)
  if (bad.length > 0) {
    for (const [name, got, want] of bad) {
      console.error(`seed: verify mismatch — ${name}: got ${got}, want ${want}`)
    }
    return false
  }
  console.log(`seed: verify OK — ${summary(c)}`)
  return true
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const known = new Set(['--force', '--verify'])
  const unknown = args.filter((a) => !known.has(a))
  if (unknown.length > 0) {
    console.error(`seed: unknown argument(s): ${unknown.join(' ')}`)
    console.error('usage: pnpm seed [--force] [--verify]')
    return 2
  }
  const force = args.includes('--force')
  const verify = args.includes('--verify')

  const config = loadConfig()
  const secrets = ensureDataDirAndSecrets(config.dataDir)
  const { db, sqlite } = openDb(join(config.dataDir, 'opendoist.db'))
  try {
    if (verify) return runVerify(db) ? 0 : 1
    return await runSeed(db, config, secrets.sessionSecret, force)
  } finally {
    sqlite.close()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('seed: failed')
    console.error(err)
    process.exit(1)
  })
