import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createTestApp, json, type TestApp } from '../../test/helpers'

let apps: TestApp[] = []
async function make(opts?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
  const t = await createTestApp(opts)
  apps.push(t)
  return t
}
afterEach(() => {
  for (const t of apps) t.close()
  apps = []
})

interface AttachmentDto {
  id: string
  file_name: string
  file_size: number
  file_type: string
  file_url: string
}

function upload(t: TestApp, file: File): Promise<Response> {
  const fd = new FormData()
  fd.append('file', file)
  return t.request('/api/v1/attachments', {
    method: 'POST',
    headers: { cookie: t.cookie },
    body: fd,
  })
}

it('uploads a file and writes it under the data dir', async () => {
  const t = await make()
  const res = await upload(t, new File(['hello world'], 'notes.txt', { type: 'text/plain' }))
  expect(res.status).toBe(201)
  const dto = await json<AttachmentDto>(res)
  expect(dto.file_name).toBe('notes.txt')
  expect(dto.file_type).toBe('text/plain')
  expect(dto.file_size).toBe(11)
  expect(dto.file_url).toBe(`/api/v1/attachments/${dto.id}/notes.txt`)
  expect(existsSync(join(t.dataDir, 'attachments', dto.id, 'notes.txt'))).toBe(true)
})

it('downloads the stored bytes with the stored content-type', async () => {
  const t = await make()
  const up = await json<AttachmentDto>(
    await upload(t, new File(['hello world'], 'notes.txt', { type: 'text/plain' })),
  )
  const res = await t.get(up.file_url)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/plain')
  expect(res.headers.get('content-disposition')).toContain('attachment')
  expect(res.headers.get('content-disposition')).toContain('notes.txt')
  expect(await res.text()).toBe('hello world')
})

it('serves images inline', async () => {
  const t = await make()
  const up = await json<AttachmentDto>(
    await upload(t, new File(['\x89PNG'], 'pic.png', { type: 'image/png' })),
  )
  const res = await t.get(up.file_url)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-disposition')).toContain('inline')
})

it('rejects uploads larger than the configured cap with 413', async () => {
  const t = await make({ env: { OPENDOIST_UPLOAD_MAX_MB: '1' } })
  const big = new Uint8Array(Math.floor(1.5 * 1024 * 1024))
  const res = await upload(t, new File([big], 'big.bin', { type: 'application/octet-stream' }))
  expect(res.status).toBe(413)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})

it('rejects a form without a file field with 400', async () => {
  const t = await make()
  const fd = new FormData()
  fd.append('notfile', 'hello')
  const res = await t.request('/api/v1/attachments', {
    method: 'POST',
    headers: { cookie: t.cookie },
    body: fd,
  })
  expect(res.status).toBe(400)
})

it('sanitizes traversal filenames to a basename inside the attachments dir', async () => {
  const t = await make()
  const dto = await json<AttachmentDto>(
    await upload(t, new File(['x'], '../../evil.txt', { type: 'text/plain' })),
  )
  expect(dto.file_name).toBe('evil.txt')
  expect(existsSync(join(t.dataDir, 'attachments', dto.id, 'evil.txt'))).toBe(true)
  // Nothing escaped the per-attachment directory.
  expect(existsSync(join(t.dataDir, 'attachments', 'evil.txt'))).toBe(false)
  expect(existsSync(join(t.dataDir, 'evil.txt'))).toBe(false)
})

it('404s on an unknown attachment id', async () => {
  const t = await make()
  const res = await t.get('/api/v1/attachments/nonexistent/notes.txt')
  expect(res.status).toBe(404)
  expect(res.headers.get('content-type')).toContain('application/problem+json')
})

it('404s when the filename does not match the stored name', async () => {
  const t = await make()
  const dto = await json<AttachmentDto>(
    await upload(t, new File(['hi'], 'a.txt', { type: 'text/plain' })),
  )
  const res = await t.get(`/api/v1/attachments/${dto.id}/wrong.txt`)
  expect(res.status).toBe(404)
})

it('publishes both attachment endpoints in the OpenAPI document', async () => {
  const t = await make()
  const res = await t.get('/api/v1/openapi.json')
  expect(res.status).toBe(200)
  const doc = await json<{ paths: Record<string, Record<string, unknown>> }>(res)

  const upload = doc.paths['/api/v1/attachments']
  expect(upload).toBeDefined()
  expect(upload).toHaveProperty('post')
  const post = upload?.post as
    | { requestBody?: { content?: Record<string, { schema?: unknown }> } }
    | undefined
  expect(post?.requestBody?.content?.['multipart/form-data']?.schema).toBeDefined()

  const download = doc.paths['/api/v1/attachments/{id}/{filename}']
  expect(download).toBeDefined()
  expect(download).toHaveProperty('get')
})
