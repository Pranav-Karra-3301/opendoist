import { describe, expect, it } from 'vitest'
import {
  countActiveTasksInProject,
  DELETE_CONFIRM_THRESHOLD,
  nameConfirmSatisfied,
  requiresNameConfirm,
} from './ProjectConfirms'

describe('countActiveTasksInProject', () => {
  const tasks = [{ project_id: 'a' }, { project_id: 'a' }, { project_id: 'b' }, { project_id: 'a' }]

  it('counts only tasks in the given project', () => {
    expect(countActiveTasksInProject(tasks, 'a')).toBe(3)
    expect(countActiveTasksInProject(tasks, 'b')).toBe(1)
    expect(countActiveTasksInProject(tasks, 'missing')).toBe(0)
    expect(countActiveTasksInProject([], 'a')).toBe(0)
  })
})

describe('requiresNameConfirm', () => {
  it('gates only above the threshold', () => {
    expect(DELETE_CONFIRM_THRESHOLD).toBe(10)
    expect(requiresNameConfirm(0)).toBe(false)
    expect(requiresNameConfirm(10)).toBe(false)
    expect(requiresNameConfirm(11)).toBe(true)
  })
})

describe('nameConfirmSatisfied', () => {
  it('accepts an exact (trimmed) match', () => {
    expect(nameConfirmSatisfied('Work', 'Work')).toBe(true)
    expect(nameConfirmSatisfied('  Work  ', 'Work')).toBe(true)
  })

  it('rejects a mismatch or case difference', () => {
    expect(nameConfirmSatisfied('work', 'Work')).toBe(false)
    expect(nameConfirmSatisfied('Wor', 'Work')).toBe(false)
    expect(nameConfirmSatisfied('', 'Work')).toBe(false)
  })

  it('never matches an empty target', () => {
    expect(nameConfirmSatisfied('', '')).toBe(false)
    expect(nameConfirmSatisfied('   ', '   ')).toBe(false)
  })
})
