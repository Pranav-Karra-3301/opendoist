import { nanoid } from 'nanoid'

export const newId = () => nanoid(16)
export const nowIso = () => new Date().toISOString()
