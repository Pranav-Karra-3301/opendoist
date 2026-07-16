/**
 * OIDC sign-in affordance for the login screen. Renders a single provider button
 * only when GET /api/v1/info reports a configured OIDC provider; otherwise nothing.
 * Phase 3 registers OIDC through better-auth's genericOAuth plugin under providerId
 * 'oidc', so the client's `signIn.oauth2` starts the redirect flow. Task C.
 */
import { useInfo } from '@/api/hooks/info'
import { authClient } from '@/auth/client'
import { Button } from '@/components/ui/button'

export function OidcButtons() {
  const { data: info } = useInfo()
  const oidc = info?.auth_providers.oidc
  if (!oidc) return null

  function startOidc() {
    // Redirects the browser to the provider; better-auth surfaces any provider
    // misconfiguration on the /api/auth callback screen.
    void authClient.signIn.oauth2({ providerId: 'oidc', callbackURL: '/today' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-caption text-text-tertiary">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={startOidc}>
        Continue with {oidc.name}
      </Button>
    </div>
  )
}
