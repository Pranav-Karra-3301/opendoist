/**
 * Log in with email + password via better-auth, with an optional OIDC provider
 * button and a first-run register link (shown only while registration is open).
 * Task C — replaces the Task A stub.
 */
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useInfo } from '@/api/hooks/info'
import { AuthField, AuthShell } from '@/auth/auth-shell'
import { authClient } from '@/auth/client'
import { OidcButtons } from '@/auth/oidc-buttons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function LoginPage() {
  const navigate = useNavigate()
  const { data: info } = useInfo()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const { error: authError } = await authClient.signIn.email({ email, password })
    if (authError) {
      setPending(false)
      setError(authError.message ?? authError.statusText ?? 'Unable to log in.')
      return
    }
    await navigate({ to: '/today' })
  }

  const disabled = pending || email.trim() === '' || password === ''

  return (
    <AuthShell
      title="Log in"
      footer={
        info?.registration_open === true ? (
          <>
            Don't have an account?{' '}
            <Link to="/register" className="font-medium text-accent hover:underline">
              Create one
            </Link>
          </>
        ) : undefined
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <AuthField id="login-email" label="Email">
          <Input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </AuthField>
        <AuthField id="login-password" label="Password">
          <Input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </AuthField>
        {error !== null && (
          <p role="alert" className="text-copy text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={disabled} aria-busy={pending}>
          {pending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <OidcButtons />
    </AuthShell>
  )
}
