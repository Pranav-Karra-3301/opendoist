export type CliErrorCode = 'auth' | 'network' | 'api' | 'usage' | 'error'

export class CliError extends Error {
  readonly exitCode: number
  readonly code: CliErrorCode
  readonly hint: string | null
  constructor(
    message: string,
    opts: { exitCode?: number; code?: CliErrorCode; hint?: string | null } = {},
  ) {
    super(message)
    this.name = 'CliError'
    this.exitCode = opts.exitCode ?? 1
    this.code = opts.code ?? 'error'
    this.hint = opts.hint ?? null
  }
}
export class AuthError extends CliError {
  constructor(message: string, hint: string | null = 'run `opentask login` to (re)authenticate') {
    super(message, { exitCode: 2, code: 'auth', hint })
    this.name = 'AuthError'
  }
}
export class NetworkError extends CliError {
  constructor(
    message: string,
    hint: string | null = 'is the server up and the URL correct? (offline?)',
  ) {
    super(message, { code: 'network', hint })
    this.name = 'NetworkError'
  }
}
export class ApiError extends CliError {
  constructor(
    message: string,
    readonly status: number,
    readonly problem: unknown = null,
  ) {
    super(message, { code: 'api' })
    this.name = 'ApiError'
  }
}
export class UsageError extends CliError {
  constructor(message: string, hint: string | null = null) {
    super(message, { code: 'usage', hint })
    this.name = 'UsageError'
  }
}
