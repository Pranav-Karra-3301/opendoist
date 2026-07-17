import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configFilePath,
  normalizeUrl,
  readConfigFile,
  resolveConnection,
  writeConfigFile,
} from './config'

let scratch: string
let configPath: string

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'od-cli-config-'))
  configPath = join(scratch, 'config.json')
  // Deterministic baseline: point config at an (initially absent) scratch file and
  // clear both credential env vars so individual tests opt in to what they need.
  vi.stubEnv('OPENDOIST_CONFIG_PATH', configPath)
  vi.stubEnv('OPENDOIST_URL', '')
  vi.stubEnv('OPENDOIST_TOKEN', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(scratch, { recursive: true, force: true })
})

describe('normalizeUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeUrl('https://todo.example.com/')).toBe('https://todo.example.com')
    expect(normalizeUrl('https://todo.example.com///')).toBe('https://todo.example.com')
  })
  it('defaults localhost / loopback hosts to http', () => {
    expect(normalizeUrl('localhost:7968')).toBe('http://localhost:7968')
    expect(normalizeUrl('127.0.0.1:7968')).toBe('http://127.0.0.1:7968')
  })
  it('defaults a remote host to https', () => {
    expect(normalizeUrl('todo.example.com')).toBe('https://todo.example.com')
  })
  it('leaves an explicit scheme untouched (bar trailing slash)', () => {
    expect(normalizeUrl('http://todo.example.com')).toBe('http://todo.example.com')
    expect(normalizeUrl('https://todo.example.com')).toBe('https://todo.example.com')
    expect(normalizeUrl('http://localhost:7968/')).toBe('http://localhost:7968')
  })
})

describe('configFilePath', () => {
  it('honors the OPENDOIST_CONFIG_PATH override', () => {
    expect(configFilePath()).toBe(configPath)
  })
})

describe('writeConfigFile / readConfigFile', () => {
  it('round-trips config and writes it 0600 (owner read/write only)', () => {
    const path = writeConfigFile({ url: 'https://todo.example.com', token: 'od_abc' })
    expect(path).toBe(configPath)
    expect(readConfigFile()).toEqual({ url: 'https://todo.example.com', token: 'od_abc' })
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })
  it('normalizes the url on write and on read', () => {
    writeConfigFile({ url: 'todo.example.com/', token: 'od_abc' })
    expect(readConfigFile()?.url).toBe('https://todo.example.com')
  })
  it('returns null for malformed JSON', () => {
    writeFileSync(configPath, '{ not json ')
    expect(readConfigFile()).toBeNull()
  })
  it('returns null when required fields are missing', () => {
    writeFileSync(configPath, JSON.stringify({ url: 'https://todo.example.com' }))
    expect(readConfigFile()).toBeNull()
  })
  it('returns null when the file is absent', () => {
    expect(readConfigFile()).toBeNull()
  })
})

describe('resolveConnection precedence', () => {
  it('resolves from env alone (source env)', () => {
    vi.stubEnv('OPENDOIST_URL', 'https://env.example.com')
    vi.stubEnv('OPENDOIST_TOKEN', 'od_env')
    expect(resolveConnection()).toEqual({
      url: 'https://env.example.com',
      token: 'od_env',
      source: 'env',
    })
  })
  it('resolves from the config file alone (source config)', () => {
    writeConfigFile({ url: 'https://file.example.com', token: 'od_file' })
    expect(resolveConnection()).toEqual({
      url: 'https://file.example.com',
      token: 'od_file',
      source: 'config',
    })
  })
  it('prefers env over file when both provide both halves (source env)', () => {
    writeConfigFile({ url: 'https://file.example.com', token: 'od_file' })
    vi.stubEnv('OPENDOIST_URL', 'https://env.example.com')
    vi.stubEnv('OPENDOIST_TOKEN', 'od_env')
    expect(resolveConnection()).toEqual({
      url: 'https://env.example.com',
      token: 'od_env',
      source: 'env',
    })
  })
  it('mixes an env url with a file token (source mixed)', () => {
    writeConfigFile({ url: 'https://file.example.com', token: 'od_file' })
    vi.stubEnv('OPENDOIST_URL', 'https://env.example.com')
    expect(resolveConnection()).toEqual({
      url: 'https://env.example.com',
      token: 'od_file',
      source: 'mixed',
    })
  })
  it('mixes a file url with an env token (source mixed)', () => {
    writeConfigFile({ url: 'https://file.example.com', token: 'od_file' })
    vi.stubEnv('OPENDOIST_TOKEN', 'od_env')
    expect(resolveConnection()).toEqual({
      url: 'https://file.example.com',
      token: 'od_env',
      source: 'mixed',
    })
  })
  it('normalizes an env url', () => {
    vi.stubEnv('OPENDOIST_URL', 'localhost:7968')
    vi.stubEnv('OPENDOIST_TOKEN', 'od_env')
    expect(resolveConnection()?.url).toBe('http://localhost:7968')
  })
  it('returns null when neither env nor file is present', () => {
    expect(resolveConnection()).toBeNull()
  })
})
