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
  return betterAuth({
    baseURL,
    basePath: '/api/auth',
    secret: sessionSecret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
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
        defaultPrefix: 'od_',
        apiKeyHeaders: ['x-api-key'],
        enableMetadata: true,
        // better-auth treats `permissions` as server-only: HTTP `/api/auth/api-key/create` cannot
        // set it. Default such keys to the explicit least-privilege shape so every od_ key carries
        // one of the two contract shapes ({opendoist:['read']} | {opendoist:['read','read_write']}).
        // read_write keys are minted in-process via `auth.api.createApiKey` until the Settings →
        // Integrations token endpoint lands (phase 5).
        permissions: { defaultPermissions: { opendoist: ['read'] } },
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
