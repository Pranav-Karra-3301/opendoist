# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets). It tracks pending version bumps and changelog entries for the npm-published packages in this monorepo.

Only `opentask` (the CLI in `packages/cli`) is published to npm — every other workspace package is `"private": true`, so changesets leaves it alone. The app ships via git tags, not changesets.

- **Add a changeset** for a user-facing CLI change: run `pnpm changeset`, pick `opentask`, choose a semver bump, and write a one-line summary. Commit the generated `.md` file alongside your code.
- **Cut a release** (maintainers only): `pnpm changeset version && pnpm install && pnpm --filter opentask build && pnpm --filter opentask publish`.

Never run `publish` from an unvetted branch or CI job — it pushes a real package to the public npm registry.
