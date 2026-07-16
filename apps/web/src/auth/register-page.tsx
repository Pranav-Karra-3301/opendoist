/**
 * First-run account creation. The first account becomes the owner; the server
 * then auto-locks registration (a locked server rejects the sign-up with a problem
 * detail we surface under the form). better-auth auto-signs-in on success, so we
 * navigate straight to /today. Task C — replaces the Task A stub.
 *
 * Confirm-password blocks submission only when it is non-empty AND mismatched, so
 * leaving it blank never traps the form (keeps the shared E2E register setup, which
 * fills name/email/password only, able to submit); a typo'd confirmation still errors.
 */
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { AuthField, AuthShell } from '@/auth/auth-shell'
import { authClient } from '@/auth/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const mismatch = confirm !== '' && confirm !== password

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mismatch) return
    setError(null)
    setPending(true)
    const { error: authError } = await authClient.signUp.email({ name, email, password })
    if (authError) {
      setPending(false)
      setError(authError.message ?? authError.statusText ?? 'Unable to create your account.')
      return
    }
    await navigate({ to: '/today' })
  }

  const disabled =
    pending || name.trim() === '' || email.trim() === '' || password === '' || mismatch

  return (
    <AuthShell
      title="Create your account"
      subtitle="First account becomes the owner."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <AuthField id="register-name" label="Name">
          <Input
            id="register-name"
            name="name"
            autoComplete="name"
            required
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
        </AuthField>
        <AuthField id="register-email" label="Email">
          <Input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </AuthField>
        <AuthField id="register-password" label="Password">
          <Input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </AuthField>
        <AuthField id="register-confirm" label="Confirm password">
          <Input
            id="register-confirm"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            disabled={pending}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'register-confirm-error' : undefined}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </AuthField>
        {mismatch && (
          <p id="register-confirm-error" role="alert" className="text-copy text-danger">
            Passwords don't match.
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-copy text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={disabled} aria-busy={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  )
}
