/**
 * better-auth browser client. Phase 3 wires OIDC through better-auth's genericOAuth
 * plugin under providerId 'oidc' (a recorded phase-3 deviation from @better-auth/sso),
 * so the matching client plugin provides `authClient.signIn.oauth2` (and, for an
 * already-authenticated user, `authClient.oauth2.link`).
 *
 * The `twoFactorClient` plugin (Task M) surfaces `authClient.twoFactor.*` — the server
 * already registers the matching `twoFactor()` plugin (apps/server/src/auth.ts), so
 * enable/verify/disable hit real endpoints for the Account settings 2FA section.
 */
import { genericOAuthClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { isTauri } from '@/api/transport'

/** AS-BUILT: better-auth 1.6 rejects a relative baseURL ("Invalid base URL: /api/auth").
 *  The server mounts better-auth at the DEFAULT basePath '/api/auth' on the same origin
 *  (apps/server/src/auth.ts), so omitting baseURL — current origin + default path — is
 *  the correct configuration (the vite dev proxy forwards /api to the server).
 *
 *  Desktop (Tauri): the SPA runs on the `tauri://localhost` origin, which better-auth
 *  ALSO rejects at module init ("URL must include 'http://' or 'https://'"), crashing the
 *  whole bundle before React mounts. Cookie auth can never work there anyway (cross-origin
 *  to the instance, no CORS) — desktop auth is the paired `ot_` bearer session, and the
 *  paired router guard never consults this client. A syntactically valid, guaranteed-dead
 *  endpoint keeps module evaluation safe and makes any stray call fail fast. The web
 *  build is untouched (`isTauri()` is false in browsers). */
export const authClient = createAuthClient({
  ...(isTauri() ? { baseURL: 'http://127.0.0.1:1/api/auth' } : {}),
  plugins: [genericOAuthClient(), twoFactorClient()],
})
