/**
 * Account settings (Task M): profile name/email, password change, TOTP two-factor,
 * connected accounts, and the danger zone (sign-out-everywhere + delete account).
 *
 * All identity mutations go through the better-auth react client (`@/auth/client`),
 * which now carries the `twoFactorClient` plugin. As-built notes:
 *  - Email is READ-ONLY: the server runs with `requireEmailVerification: false` and no
 *    `changeEmail` flow (apps/server/src/auth.ts), so there is no safe self-serve change.
 *  - No QR library is installed, so 2FA setup renders the `otpauth://` URI + secret as
 *    copyable text for manual authenticator entry (no new deps, per the task).
 *  - The server already registers `twoFactor()`, so enable/verify/disable hit live routes.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Lock } from 'lucide-react'
import { type ComponentProps, type FormEvent, type ReactNode, useState } from 'react'
import { useInfo } from '@/api/hooks/info'
import { qk } from '@/api/keys'
import { authClient } from '@/auth/client'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/toasts'
import { SettingRow, SettingsSection } from '../ui'
import {
  canDeleteAccount,
  isValidTotpCode,
  providerLabel,
  totpSecretFromUri,
  validatePasswordChange,
} from './account-logic'

type Msg = { tone: 'ok' | 'err'; text: string } | null

/** Better-auth error objects carry an optional message; normalise to a string. */
function errText(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message && error.message.length > 0 ? error.message : fallback
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.info('Copied')
  } catch {
    toast.error('Copy failed — copy it manually')
  }
}

// ---------------------------------------------------------------------------
// Small shared building blocks
// ---------------------------------------------------------------------------

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-4 py-3', className)}>{children}</div>
}

function Field({
  id,
  label,
  className,
  ...rest
}: { id: string; label: string } & ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-copy text-text-secondary">
        {label}
      </label>
      <Input id={id} className={cn('max-w-sm', className)} {...rest} />
    </div>
  )
}

function InlineMessage({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <p
      role={msg.tone === 'err' ? 'alert' : 'status'}
      className={cn('text-copy', msg.tone === 'err' ? 'text-danger' : 'text-success')}
    >
      {msg.text}
    </p>
  )
}

function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-sm border border-border bg-surface px-2 py-1 font-mono text-caption text-text-primary">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => void copyToClipboard(value)}
      >
        <Copy size={16} aria-hidden="true" />
        Copy
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileSection({
  name: initialName,
  email,
  onSaved,
}: {
  name: string
  email: string
  onSaved: () => void
}) {
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const trimmed = name.trim()
  const disabled = busy || trimmed.length === 0 || trimmed === initialName.trim()

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await authClient.updateUser({ name: trimmed })
    setBusy(false)
    if (error) {
      setMsg({ tone: 'err', text: errText(error, 'Could not update your name.') })
      return
    }
    setMsg({ tone: 'ok', text: 'Name updated.' })
    onSaved()
  }

  return (
    <SettingsSection title="Profile" description="How you appear across OpenDoist.">
      <Cell>
        <form onSubmit={save} className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-4">
            <Field
              id="account-name"
              label="Name"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={disabled} aria-busy={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          <InlineMessage msg={msg} />
        </form>
      </Cell>
      <Cell>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-copy text-text-secondary">Email</div>
            <div className="truncate text-body text-text-primary">{email}</div>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                aria-label="Why can't I change my email?"
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
              >
                <Lock size={16} aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                Your email is managed by this instance and can't be changed here.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Cell>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = validatePasswordChange({ current, next, confirm })
    if (invalid) {
      setMsg({ tone: 'err', text: invalid })
      return
    }
    setBusy(true)
    setMsg(null)
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    })
    setBusy(false)
    if (error) {
      setMsg({ tone: 'err', text: errText(error, 'Could not change your password.') })
      return
    }
    setMsg({ tone: 'ok', text: 'Password updated. Other sessions were signed out.' })
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  return (
    <SettingsSection title="Password" description="Change the password you use to sign in.">
      <Cell>
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <Field
            id="account-current-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <Field
            id="account-new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <Field
            id="account-confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <InlineMessage msg={msg} />
          <div className="flex justify-end">
            <Button type="submit" disabled={busy} aria-busy={busy}>
              {busy ? 'Updating…' : 'Change password'}
            </Button>
          </div>
        </form>
      </Cell>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

function EnableTwoFactorDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(
    null,
  )
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setPassword('')
      setEnrollment(null)
      setCode('')
      setBusy(false)
      setMsg(null)
    }
  }

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await authClient.twoFactor.enable({ password })
    setBusy(false)
    if (error || !data) {
      setMsg({ tone: 'err', text: errText(error, 'Could not start 2FA setup.') })
      return
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes })
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isValidTotpCode(code)) {
      setMsg({ tone: 'err', text: 'Enter the 6-digit code from your authenticator app.' })
      return
    }
    setBusy(true)
    setMsg(null)
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() })
    setBusy(false)
    if (error) {
      setMsg({ tone: 'err', text: errText(error, "That code didn't match. Try again.") })
      return
    }
    toast.info('Two-factor authentication enabled')
    handleOpenChange(false)
    onDone()
  }

  const secret = enrollment ? totpSecretFromUri(enrollment.totpURI) : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Enable two-factor authentication</DialogTitle>
          <DialogDescription>
            {enrollment
              ? 'Add this secret to your authenticator app, then enter the code it shows.'
              : 'Confirm your password to begin setup.'}
          </DialogDescription>
        </DialogHeader>
        {enrollment ? (
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <div className="text-copy text-text-secondary">Setup key (otpauth URI)</div>
              <CopyField value={enrollment.totpURI} label="setup URI" />
              {secret ? (
                <>
                  <div className="text-copy text-text-secondary">Or enter this secret manually</div>
                  <CopyField value={secret} label="secret" />
                </>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-copy text-text-secondary">
                Backup codes — store these somewhere safe
              </div>
              <ul className="grid grid-cols-2 gap-1 rounded-sm border border-border bg-surface p-2 font-mono text-caption text-text-primary">
                {enrollment.backupCodes.map((backupCode) => (
                  <li key={backupCode}>{backupCode}</li>
                ))}
              </ul>
            </div>
            <Field
              id="account-2fa-code"
              label="6-digit code"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <InlineMessage msg={msg} />
            <DialogFooter>
              <DialogClose className={cn(buttonVariants({ variant: 'ghost' }))}>Cancel</DialogClose>
              <Button type="submit" disabled={busy} aria-busy={busy}>
                {busy ? 'Verifying…' : 'Verify & enable'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={begin} className="flex flex-col gap-4" noValidate>
            <Field
              id="account-2fa-password"
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <InlineMessage msg={msg} />
            <DialogFooter>
              <DialogClose className={cn(buttonVariants({ variant: 'ghost' }))}>Cancel</DialogClose>
              <Button type="submit" disabled={busy || password.length === 0} aria-busy={busy}>
                {busy ? 'Starting…' : 'Continue'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableTwoFactorDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setPassword('')
      setBusy(false)
      setMsg(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await authClient.twoFactor.disable({ password })
    setBusy(false)
    if (error) {
      setMsg({ tone: 'err', text: errText(error, 'Could not disable 2FA.') })
      return
    }
    toast.info('Two-factor authentication disabled')
    handleOpenChange(false)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Disable two-factor authentication</DialogTitle>
          <DialogDescription>
            Confirm your password to turn off 2FA. Your account will be less protected.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            id="account-2fa-disable-password"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <InlineMessage msg={msg} />
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: 'ghost' }))}>Cancel</DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || password.length === 0}
              aria-busy={busy}
            >
              {busy ? 'Disabling…' : 'Disable 2FA'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TwoFactorSection({
  enabled,
  available,
  onChanged,
}: {
  enabled: boolean
  available: boolean
  onChanged: () => void
}) {
  const [enableOpen, setEnableOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)

  if (!available) {
    return (
      <SettingsSection
        title="Two-factor authentication"
        description="Protect sign-in with a time-based one-time passcode (TOTP)."
      >
        <Cell>
          <p className="text-copy text-text-secondary">
            Two-factor authentication isn't available yet — it needs a server restart to turn on.
          </p>
        </Cell>
      </SettingsSection>
    )
  }

  return (
    <>
      <SettingsSection
        title="Two-factor authentication"
        description="Protect sign-in with a time-based one-time passcode (TOTP) from an authenticator app."
      >
        <SettingRow
          label={enabled ? 'Two-factor authentication is on' : 'Two-factor authentication is off'}
          description={
            enabled
              ? "You'll enter a 6-digit code when you sign in."
              : 'Add an extra step when signing in.'
          }
          control={
            enabled ? (
              <Button variant="outline" onClick={() => setDisableOpen(true)}>
                Disable 2FA
              </Button>
            ) : (
              <Button onClick={() => setEnableOpen(true)}>Enable 2FA</Button>
            )
          }
        />
      </SettingsSection>
      <EnableTwoFactorDialog open={enableOpen} onOpenChange={setEnableOpen} onDone={onChanged} />
      <DisableTwoFactorDialog open={disableOpen} onOpenChange={setDisableOpen} onDone={onChanged} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Connected accounts
// ---------------------------------------------------------------------------

interface LinkedAccount {
  id: string
  providerId: string
  createdAt: string | Date
}

function formatLinkedDate(value: string | Date): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ConnectedAccountsSection() {
  const { data: info } = useInfo()
  const oidc = info?.auth_providers.oidc ?? null

  const accountsQuery = useQuery<LinkedAccount[]>({
    queryKey: ['auth', 'accounts'],
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts()
      if (error) throw new Error(errText(error, 'Could not load connected accounts.'))
      return (data ?? []).map((account) => ({
        id: account.id,
        providerId: account.providerId,
        createdAt: account.createdAt,
      }))
    },
  })

  const accounts = accountsQuery.data ?? []
  const oidcLinked = accounts.some((account) => account.providerId === 'oidc')

  function link() {
    // Redirects the browser to the provider; returns to this page once linked.
    void authClient.oauth2.link({ providerId: 'oidc', callbackURL: '/settings/account' })
  }

  return (
    <SettingsSection title="Connected accounts" description="Ways you can sign in to this account.">
      {accountsQuery.isLoading ? (
        <Cell>
          <p className="text-copy text-text-tertiary">Loading…</p>
        </Cell>
      ) : accounts.length === 0 ? (
        <Cell>
          <p className="text-copy text-text-tertiary">No connected accounts.</p>
        </Cell>
      ) : (
        accounts.map((account) => {
          const linkedOn = formatLinkedDate(account.createdAt)
          return (
            <SettingRow
              key={account.id}
              label={providerLabel(account.providerId, oidc?.name)}
              description={linkedOn ? `Linked ${linkedOn}` : 'Connected'}
              control={null}
            />
          )
        })
      )}
      {oidc && !oidcLinked ? (
        <SettingRow
          label={`Link ${oidc.name}`}
          description="Sign in with single sign-on."
          control={
            <Button variant="outline" onClick={link}>
              Link {oidc.name}
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  email: string
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setTyped('')
      setBusy(false)
      setMsg(null)
    }
  }

  const confirmed = canDeleteAccount(typed, email)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirmed) return
    setBusy(true)
    setMsg(null)
    const { error } = await authClient.deleteUser({})
    if (error) {
      setBusy(false)
      setMsg({ tone: 'err', text: errText(error, 'Could not delete your account.') })
      return
    }
    // Hard redirect so the router guard re-runs against the now-deleted session.
    window.location.href = '/login'
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This permanently deletes your account and all of your tasks, projects, and data. This
            can't be undone.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            id="account-delete-confirm"
            label={`Type ${email} to confirm`}
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <InlineMessage msg={msg} />
          <DialogFooter>
            <DialogClose className={cn(buttonVariants({ variant: 'ghost' }))}>Cancel</DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={!confirmed || busy}
              aria-busy={busy}
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DangerZone({ email }: { email: string }) {
  const [signingOut, setSigningOut] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function signOutEverywhere() {
    setSigningOut(true)
    await authClient.revokeSessions()
    await authClient.signOut()
    // Hard navigate so the guard re-runs against the cleared session.
    window.location.href = '/login'
  }

  return (
    <section className="mb-8">
      <h2 className="mb-1 font-medium text-danger text-subtitle">Danger zone</h2>
      <p className="mb-3 max-w-prose text-copy text-text-secondary">
        Irreversible and destructive actions.
      </p>
      <div className="divide-y divide-border-subtle rounded-lg border border-danger bg-surface-raised">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-body text-text-primary">Sign out everywhere</div>
            <div className="text-caption text-text-tertiary">
              Revoke every active session, including this one.
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void signOutEverywhere()}
            disabled={signingOut}
            aria-busy={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <div className="text-body text-text-primary">Delete account</div>
            <div className="text-caption text-text-tertiary">
              Permanently erase your account and all of your data.
            </div>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete account
          </Button>
        </div>
      </div>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} email={email} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AccountPage() {
  const session = authClient.useSession()
  const queryClient = useQueryClient()
  const user = session.data?.user

  if (!user) {
    return (
      <SettingsSection title="Account">
        <Cell>
          <p className="text-copy text-text-tertiary">
            {session.isPending ? 'Loading your account…' : "You're not signed in."}
          </p>
        </Cell>
      </SettingsSection>
    )
  }

  // `twoFactorEnabled` is added to the session user by the twoFactor plugin; read it
  // defensively so a client without the plugin degrades to "off" instead of crashing.
  const twoFactorEnabled = Boolean((user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled)
  const twoFactorApi = authClient.twoFactor as { enable?: unknown } | undefined
  const twoFactorAvailable = typeof twoFactorApi?.enable === 'function'

  return (
    <>
      <ProfileSection
        name={user.name}
        email={user.email}
        onSaved={() => {
          void session.refetch()
          void queryClient.invalidateQueries({ queryKey: qk.user })
        }}
      />
      <PasswordSection />
      <TwoFactorSection
        enabled={twoFactorEnabled}
        available={twoFactorAvailable}
        onChanged={() => void session.refetch()}
      />
      <ConnectedAccountsSection />
      <DangerZone email={user.email} />
    </>
  )
}
