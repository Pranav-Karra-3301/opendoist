/**
 * better-auth browser client. Phase 3 wires OIDC through better-auth's genericOAuth
 * plugin under providerId 'oidc' (a recorded phase-3 deviation from @better-auth/sso),
 * so the matching client plugin provides `authClient.signIn.oauth2`.
 */
import { genericOAuthClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

/** AS-BUILT: better-auth 1.6 rejects a relative baseURL ("Invalid base URL: /api/auth").
 *  The server mounts better-auth at the DEFAULT basePath '/api/auth' on the same origin
 *  (apps/server/src/auth.ts), so omitting baseURL — current origin + default path — is
 *  the correct configuration (the vite dev proxy forwards /api to the server). */
export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
})
