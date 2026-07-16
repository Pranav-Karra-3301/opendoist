import { and, eq, isNull, max, sql } from 'drizzle-orm'
import type { Db } from '../db/db'
import { projects, sections } from '../db/schema'
import { newId, nowIso } from '../lib/ids'

/** Result of resolving a `#project` / `/section` token: the row id and whether it was just created. */
export interface ResolveResult {
  id: string
  created: boolean
}

/**
 * Case-insensitive match against the user's non-deleted projects; when absent, creates a
 * top-level project (palette `charcoal`, `child_order` appended among top-level siblings).
 * Used only by the Quick Add route to materialize `#Project` tokens.
 */
export function resolveProject(db: Db, userId: string, name: string): ResolveResult {
  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        isNull(projects.deletedAt),
        sql`lower(${projects.name}) = lower(${name})`,
      ),
    )
    .get()
  if (existing !== undefined) return { id: existing.id, created: false }

  const maxOrder = db
    .select({ m: max(projects.childOrder) })
    .from(projects)
    .where(and(eq(projects.userId, userId), isNull(projects.parentId), isNull(projects.deletedAt)))
    .get()
  const now = nowIso()
  const id = newId()
  db.insert(projects)
    .values({
      id,
      userId,
      name,
      color: 'charcoal',
      childOrder: (maxOrder?.m ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { id, created: true }
}

/**
 * Case-insensitive match against a project's non-deleted sections; when absent, creates one
 * (`section_order` appended). Used only by the Quick Add route to materialize `/Section` tokens.
 */
export function resolveSection(
  db: Db,
  userId: string,
  projectId: string,
  name: string,
): ResolveResult {
  const existing = db
    .select({ id: sections.id })
    .from(sections)
    .where(
      and(
        eq(sections.userId, userId),
        eq(sections.projectId, projectId),
        isNull(sections.deletedAt),
        sql`lower(${sections.name}) = lower(${name})`,
      ),
    )
    .get()
  if (existing !== undefined) return { id: existing.id, created: false }

  const maxOrder = db
    .select({ m: max(sections.sectionOrder) })
    .from(sections)
    .where(
      and(
        eq(sections.userId, userId),
        eq(sections.projectId, projectId),
        isNull(sections.deletedAt),
      ),
    )
    .get()
  const now = nowIso()
  const id = newId()
  db.insert(sections)
    .values({
      id,
      userId,
      projectId,
      name,
      sectionOrder: (maxOrder?.m ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { id, created: true }
}
