import { describe, expect, it } from 'vitest'
import { type ChangelogEntry, parseChangelog, selectChangelogEntry } from './changelog'

const FIXTURE = `# Changelog

All notable changes to OpenDoist.

## [Unreleased]

### Features

- New shiny thing
- Another [linked](https://example.com/x) thing

## [0.2.0] - 2026-07-10

### Features

- Nightly backups
- Todoist import

### Fixes

- Squashed a ![bug](img.png) icon

## [0.1.0] - 2026-06-01

### Features

- Initial release
`

describe('parseChangelog', () => {
  it('parses Unreleased plus two versions into the exact structure', () => {
    expect(parseChangelog(FIXTURE)).toEqual<ChangelogEntry[]>([
      {
        version: 'Unreleased',
        date: null,
        sections: [{ title: 'Features', items: ['New shiny thing', 'Another linked thing'] }],
      },
      {
        version: '0.2.0',
        date: '2026-07-10',
        sections: [
          { title: 'Features', items: ['Nightly backups', 'Todoist import'] },
          { title: 'Fixes', items: ['Squashed a bug icon'] },
        ],
      },
      {
        version: '0.1.0',
        date: '2026-06-01',
        sections: [{ title: 'Features', items: ['Initial release'] }],
      },
    ])
  })

  it('strips inline markdown links and images down to their text', () => {
    const [entry] = parseChangelog('## [1.0.0] - 2026-01-01\n\n### X\n\n- see [docs](https://d)')
    expect(entry?.sections[0]?.items[0]).toBe('see docs')
  })

  it('ignores the title, preamble, and stray list items before any version heading', () => {
    expect(parseChangelog('# Changelog\n\n- orphan item\n\nsome prose')).toEqual([])
  })

  it('tolerates CRLF line endings and an undated Unreleased heading', () => {
    expect(parseChangelog('## [Unreleased]\r\n\r\n### Added\r\n\r\n- a\r\n- b\r\n')).toEqual<
      ChangelogEntry[]
    >([{ version: 'Unreleased', date: null, sections: [{ title: 'Added', items: ['a', 'b'] }] }])
  })

  it('returns [] for empty or non-changelog input', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog('just some text\nwith no headings')).toEqual([])
  })
})

describe('selectChangelogEntry', () => {
  const entries = parseChangelog(FIXTURE)

  it('returns the entry matching the requested version', () => {
    expect(selectChangelogEntry(entries, '0.2.0')?.version).toBe('0.2.0')
  })

  it('falls back to the newest entry when the version is unknown or missing', () => {
    expect(selectChangelogEntry(entries, '9.9.9')?.version).toBe('Unreleased')
    expect(selectChangelogEntry(entries, undefined)?.version).toBe('Unreleased')
  })

  it('returns null when there are no entries', () => {
    expect(selectChangelogEntry([], '0.1.0')).toBeNull()
  })
})
