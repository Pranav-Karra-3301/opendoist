import { describe, expect, it } from 'vitest'
import type { Project } from '@/api/schemas'
import { collectSubtreeIds, eligibleParents } from './ProjectDialog'

function mk(p: Partial<Project> & { id: string }): Project {
  return {
    id: p.id,
    name: p.name ?? p.id,
    description: p.description ?? '',
    color: p.color ?? 'charcoal',
    parent_id: p.parent_id ?? null,
    child_order: p.child_order ?? 0,
    is_favorite: p.is_favorite ?? false,
    is_archived: p.is_archived ?? false,
    is_collapsed: p.is_collapsed ?? false,
    is_inbox: p.is_inbox ?? false,
  }
}

describe('collectSubtreeIds', () => {
  const tree = [
    mk({ id: 'a' }),
    mk({ id: 'b', parent_id: 'a' }),
    mk({ id: 'c', parent_id: 'b' }),
    mk({ id: 'sibling', parent_id: 'a' }),
    mk({ id: 'unrelated' }),
  ]

  it('includes the root plus every descendant', () => {
    expect(collectSubtreeIds(tree, 'a')).toEqual(new Set(['a', 'b', 'c', 'sibling']))
  })

  it('a leaf resolves to just itself', () => {
    expect(collectSubtreeIds(tree, 'c')).toEqual(new Set(['c']))
  })

  it('excludes unrelated branches', () => {
    expect(collectSubtreeIds(tree, 'a').has('unrelated')).toBe(false)
  })
})

describe('eligibleParents', () => {
  const projects = [
    mk({ id: 'inbox', name: 'Inbox', is_inbox: true }),
    mk({ id: 'work', name: 'Work' }),
    mk({ id: 'sub', name: 'Sub', parent_id: 'work' }),
    mk({ id: 'archived', name: 'Old', is_archived: true }),
    mk({ id: 'life', name: 'Life' }),
  ]

  it('creating a project: excludes the Inbox and archived projects, sorted by name', () => {
    expect(eligibleParents(projects).map((p) => p.id)).toEqual(['life', 'sub', 'work'])
  })

  it('editing a project: excludes itself and its descendants (cycle prevention)', () => {
    expect(eligibleParents(projects, 'work').map((p) => p.id)).toEqual(['life'])
  })

  it('editing a leaf: only itself is excluded', () => {
    expect(eligibleParents(projects, 'life').map((p) => p.id)).toEqual(['sub', 'work'])
  })
})
