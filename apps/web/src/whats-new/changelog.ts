/**
 * Bundled changelog. Parses the repo-root `CHANGELOG.md` (Keep-a-Changelog format)
 * into structured entries for the What's New dialog and the account-menu footer.
 *
 * The `?raw` import is served from the repo root via `server.fs.allow` in
 * `apps/web/vite.config.ts` (Task A). `parseChangelog` is pure and unit-tested;
 * `changelogEntries` is the parsed bundle used by the UI.
 */
import changelogRaw from '../../../../CHANGELOG.md?raw'

export interface ChangelogSection {
  title: string
  items: string[]
}

export interface ChangelogEntry {
  /** `'Unreleased'` or a semver such as `'0.1.0'` (verbatim from the `## [..]` heading). */
  version: string
  /** Release date `YYYY-MM-DD`, or `null` for Unreleased / undated entries. */
  date: string | null
  sections: ChangelogSection[]
}

/** `## [Unreleased]` or `## [1.2.3] - 2026-07-15` (date optional). */
const VERSION_HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/
/** `### Features`, `### Fixes`, … */
const SECTION_HEADING = /^###\s+(.+?)\s*$/
/** `- item` or `* item`. */
const LIST_ITEM = /^[-*]\s+(.+?)\s*$/
/** Inline markdown links and images → their visible text. */
const MD_LINK = /!?\[([^\]]+)\]\([^)]*\)/g

/** Reduce markdown links/images to their text and trim surrounding whitespace. */
function stripMarkdown(text: string): string {
  return text.replace(MD_LINK, '$1').trim()
}

/**
 * Parse Keep-a-Changelog markdown into entries (in document order — newest first
 * by convention). Lines before the first `## [..]` heading (the `# Changelog`
 * title and preamble) are ignored. Empty or non-changelog input yields `[]`.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let section: ChangelogSection | null = null

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd()

    const versionMatch = VERSION_HEADING.exec(line)
    if (versionMatch !== null) {
      const name = versionMatch[1]
      if (name === undefined) continue
      entry = { version: name.trim(), date: versionMatch[2] ?? null, sections: [] }
      section = null
      entries.push(entry)
      continue
    }
    // Skip anything until the first version heading (title + preamble).
    if (entry === null) continue

    const sectionMatch = SECTION_HEADING.exec(line)
    if (sectionMatch !== null) {
      const title = sectionMatch[1]
      if (title === undefined) continue
      section = { title: title.trim(), items: [] }
      entry.sections.push(section)
      continue
    }

    const itemMatch = LIST_ITEM.exec(line)
    if (itemMatch !== null && section !== null) {
      const raw = itemMatch[1]
      if (raw === undefined) continue
      const item = stripMarkdown(raw)
      if (item.length > 0) section.items.push(item)
    }
  }

  return entries
}

/** Parsed entries from the bundled `CHANGELOG.md`, in document order (newest first). */
export const changelogEntries: ChangelogEntry[] = parseChangelog(changelogRaw)

/**
 * The entry to feature: the one matching `version` (exact string match against the
 * heading label), else the newest entry (index 0, which may be `Unreleased`).
 * Returns `null` only when there are no entries at all.
 */
export function selectChangelogEntry(
  entries: ChangelogEntry[],
  version: string | undefined,
): ChangelogEntry | null {
  if (entries.length === 0) return null
  if (version !== undefined) {
    const match = entries.find((e) => e.version === version)
    if (match !== undefined) return match
  }
  return entries[0] ?? null
}
