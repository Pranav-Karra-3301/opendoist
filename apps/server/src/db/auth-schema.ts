import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Hand-written better-auth 1.6 tables for the Drizzle adapter — property names camelCase
 * (better-auth model fields), column names snake_case. Date-ish better-auth fields are
 * `integer({ mode: 'timestamp_ms' })` so the adapter's `Date` values round-trip.
 */

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const twoFactor = sqliteTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // better-auth 1.6.23 twoFactor model fields (all `input: false`, server-managed). The Drizzle
  // adapter requires every model field to exist or `/two-factor/enable` 500s ("The field
  // 'verified' does not exist in the 'twoFactor' Drizzle schema"). Added per Task A Step 5's
  // instruction to the Task J worker; regenerated migration 0002.
  verified: integer('verified', { mode: 'boolean' }).default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
})

export const apikey = sqliteTable('apikey', {
  id: text('id').primaryKey(),
  // @better-auth/api-key 1.6 model: configId + referenceId (owner user id) instead of userId
  configId: text('config_id').notNull().default('default'),
  name: text('name'),
  start: text('start'),
  prefix: text('prefix'),
  key: text('key').notNull(),
  referenceId: text('reference_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  refillInterval: integer('refill_interval'),
  refillAmount: integer('refill_amount'),
  lastRefillAt: integer('last_refill_at', { mode: 'timestamp_ms' }),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  rateLimitEnabled: integer('rate_limit_enabled', { mode: 'boolean' }).default(false),
  rateLimitTimeWindow: integer('rate_limit_time_window'),
  rateLimitMax: integer('rate_limit_max'),
  requestCount: integer('request_count').default(0),
  remaining: integer('remaining'),
  lastRequest: integer('last_request', { mode: 'timestamp_ms' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  permissions: text('permissions'),
  metadata: text('metadata'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
