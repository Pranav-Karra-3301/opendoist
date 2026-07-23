// better-auth 1.6 ships the api-key plugin as a scoped package (not better-auth/plugins)
import { apiKey } from '@better-auth/api-key'
import { hash, verify } from '@node-rs/argon2'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { genericOAuth, twoFactor } from 'better-auth/plugins'
import { count } from 'drizzle-orm'
import { SettingsSchema } from './api/schemas'
import type { Config } from './config'
import * as authSchema from './db/auth-schema'
import type { Db } from './db/db'
import { projects, userSettings } from './db/schema'
import { newId, nowIso } from './lib/ids'

const ARGON2 = { memoryCost: 65536, timeCost: 3, parallelism: 4 }

/**
 * Generic OIDC-from-env is implemented with better-auth's built-in `genericOAuth` plugin
 * (deterministic env config, no DB seeding) instead of `@better-auth/sso` — same product
 * behavior (issuer/client/secret env → SSO button via `/info`); `@better-auth/sso` is
 * deferred to whenever Settings-managed multi-provider lands.
 */
export function createAuth(db: Db, config: Config, sessionSecret: string) {
  const baseURL = config.publicUrl ?? `http://localhost:${config.port}`
  // In dev the SPA is served by a separate Vite dev server (a different origin) and the
  // browser's requests carry that origin; the server bundles no SPA (webDistDir === null),
  // so trust the Vite dev origins there. In production the server serves the SPA itself, so
  // the origin equals baseURL and only baseURL is trusted.
  const devOrigins =
    config.webDistDir === null ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []
  return betterAuth({
    baseURL,
    basePath: '/api/auth',
    secret: sessionSecret,
    trustedOrigins: [baseURL, ...devOrigins],
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    account: {
      accountLinking: {
        enabled: true,
        // Auto-link an OIDC sign-in to the existing email-matched account. Safe on this
        // instance shape: single-user, registration-locked, and the IdP (e.g. Pocket ID)
        // is self-hosted by the same person — whoever controls the IdP already controls
        // SSO identity. Without this, a login-screen OIDC tap before manually connecting
        // in Settings → Account dead-ends on better-auth's untrusted-provider default.
        trustedProviders: ['oidc'],
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: h, password }) => verify(h, password, ARGON2),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [row] = await db.select({ n: count() }).from(authSchema.user)
            if ((row?.n ?? 0) > 0 && !config.allowRegistration)
              throw new APIError('FORBIDDEN', {
                message: 'Registration is closed on this instance',
              })
            return { data: user }
          },
          after: async (user) => {
            const now = nowIso()
            await db.insert(projects).values({
              id: newId(),
              userId: user.id,
              name: 'Inbox',
              isInbox: true,
              childOrder: 0,
              createdAt: now,
              updatedAt: now,
            })
            await db.insert(userSettings).values({
              userId: user.id,
              settings: JSON.stringify(SettingsSchema.parse({})),
              updatedAt: now,
            })
          },
        },
      },
    },
    plugins: [
      twoFactor(),
      apiKey({
        defaultPrefix: 'ot_',
        apiKeyHeaders: ['x-api-key'],
        enableMetadata: true,
        // better-auth's api-key plugin ships a 10-requests-per-day default rate limit; the 11th
        // `verifyApiKey` throws RATE_LIMITED, which the bearer middleware reads as an invalid key
        // (401). ot_ tokens are the CLI's/API's primary auth on a self-hosted instance, so the
        // plugin-level limiter is disabled (phase-9 integration gate finding).
        rateLimit: { enabled: false },
        // better-auth treats `permissions` as server-only: HTTP `/api/auth/api-key/create` cannot
        // set it. Default such keys to the explicit least-privilege shape so every ot_ key carries
        // one of the two contract shapes ({opentask:['read']} | {opentask:['read','read_write']}).
        // read_write keys are minted in-process via `auth.api.createApiKey` until the Settings →
        // Integrations token endpoint lands (phase 5).
        permissions: { defaultPermissions: { opentask: ['read'] } },
      }),
      ...(config.oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: 'oidc',
                  discoveryUrl: `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
                  clientId: config.oidc.clientId,
                  clientSecret: config.oidc.clientSecret,
                  scopes: ['openid', 'profile', 'email'],
                },
              ],
            }),
          ]
        : []),
    ],
  })
}
export type Auth = ReturnType<typeof createAuth>
