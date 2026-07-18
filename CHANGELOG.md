# Changelog

All notable changes to OpenDoist.
## [0.1.0] - 2026-07-18

### Bug Fixes
- *(web,server)* Exact undo restoration, day-group counts (phase-5 review)
- *(server)* Trust Vite dev origin for auth in split dev mode
- *(ci)* Strip corepack integrity hash from packageManager field
- *(docker)* Keep CHANGELOG.md in the build context
- *(web)* Hoist quickadd pure helpers out of the component graph

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
