# Changelog

All notable changes to OpenTask.
## [0.4.1] - 2026-07-23

### Features
- *(desktop)* Seamless macOS window chrome + dedicated updater feed (v0.2.0)
- *(reminders)* Lead-aware notification copy — "Due in 30 min" / "Due now"
## [0.4.0] - 2026-07-23

### Documentation
- Add author backlink in README license line

### Features
- *(web)* Board layout — kanban renderer over the existing grouped pipeline
- Rebrand OpenDoist to OpenTask

### Maintenance
- *(release)* V0.4.0
## [0.3.2] - 2026-07-22

### Features
- *(web)* Missed tone — same-day timed dues past their time paint warning orange

### Maintenance
- *(release)* V0.3.2
## [0.3.1] - 2026-07-22

### Bug Fixes
- *(reminders)* Claim born-past relative reminders instead of firing them late

### Maintenance
- *(release)* V0.3.1
## [0.3.0] - 2026-07-22

### Bug Fixes
- *(web)* Accent swatches preview their own accent; rename Todoist accent to Red
- *(quick-add)* Keep a typed /section ahead of the section-row context

### Documentation
- Plan the Board view pass (layout pref + kanban renderer over existing groups)

### Features
- *(quick-add)* Hold list-row context as a preset, not input text

### Maintenance
- *(release)* V0.3.0

### Testing
- *(e2e)* Assert composer context via preset chips, not seeded input text
## [0.2.0] - 2026-07-22

### Documentation
- Plan the Views & Chrome pass (owner feedback)
- Plan the Settings modal polish (Todoist-style two-pane)
- Expand stage-2 plan to Settings & Theme (user-menu entry + appearance×accent)

### Features
- *(web)* Views & Chrome pass — sidebar chrome, Display menu, task-row polish, subtask fix
- *(web)* Settings & Theme pass — modal polish, user-menu entry, appearance×accent theme
- *(reminders)* Always add an at-time automatic reminder

### Maintenance
- *(release)* V0.2.0
## [0.1.1] - 2026-07-20

### Bug Fixes
- *(release)* Dispatch versioned image publish explicitly

### Documentation
- Plan the Quick Add UX pass (owner feedback)
- Plan addendum — Quick Add entry-point semantics (Space, inline composers)

### Features
- *(web)* Quick Add UX pass — positioning, calendar, deadline time, chip pickers
- *(web)* Quick Add entry-point semantics — Space opener + inline composers

### Maintenance
- *(release)* V0.1.1
## [0.1.0] - 2026-07-18

### Bug Fixes
- *(web,server)* Exact undo restoration, day-group counts (phase-5 review)
- *(server)* Trust Vite dev origin for auth in split dev mode
- *(ci)* Strip corepack integrity hash from packageManager field
- *(docker)* Keep CHANGELOG.md in the build context
- *(web)* Hoist quickadd pure helpers out of the component graph
- *(release)* Annotate and explicitly push the version tag

### Documentation
- Add design spec, research dossier, and brand assets
- Add phase 1-2 implementation plan (foundation + core engines)
- Add phase 3-10 implementation plans (consistency-reviewed)
- *(spec)* Record as-built OIDC via better-auth genericOAuth plugin
- Add browser extension + Tauri macOS app implementation plans

### Features
- *(core)* Quick add parser, recurrence engine, filter engine
- *(web)* Design tokens and theme showcase
- *(server)* REST API, auth, SSE, FTS5 search, and Docker packaging
- *(web)* Full app shell — views, Quick Add, keyboard-first UX
- *(web,server)* View engine, filters UI, full settings, reporting, undo
- *(server,web)* Reminders — scheduler, channels, Web Push, iCal feed
- *(cli)* Opendoist command-line client
- *(server,web)* Ramble — voice capture to confirmed tasks
- *(server,web,core)* Backups, Todoist importer, karma, What's New, export
- *(web,server,docs)* PWA, a11y pass, performance, seed, docs, release engineering
- *(desktop)* Tauri 2 macOS app — menu-bar Quick Add, native reminders
- *(server)* Auto-link email-matched OIDC sign-ins (trusted provider)

### Maintenance
- Scaffold pnpm monorepo, CI, and repo meta
- *(release)* Prepare v0.1.0
- Gitignore nested dev data dir (apps/server/data)
- *(release)* V0.1.0
- *(release)* V0.1.0
