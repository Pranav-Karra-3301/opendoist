/**
 * Calendar-feed card (phase 6 Task M) — mounted inside Settings → Integrations by Task A.
 * Loads the user's iCal capability token (GET /api/v1/ical-token, auto-created server-side on
 * first call), surfaces the https + webcal:// subscription URLs with copy-to-clipboard, and
 * offers a confirmed rotate (POST /api/v1/ical-token/rotate) that invalidates the cached token
 * so any leaked link stops working immediately.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ApiError, api } from '@/api/client'
import { qk } from '@/api/keys'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/stores/toasts'
import { SettingsSection } from './ui'

/**
 * Frozen iCal-token DTO (plan Task J): both GET /ical-token and POST /ical-token/rotate return
 * this snake_case shape. Declared locally — the web app never imports server code.
 */
const IcalTokenSchema = z.object({
  token: z.string(),
  url: z.string(),
  webcal_url: z.string(),
  created_at: z.string(),
})

const getIcalToken = () => api('/ical-token', { schema: IcalTokenSchema })
const rotateIcalToken = () => api('/ical-token/rotate', { method: 'POST', schema: IcalTokenSchema })

export default function CalendarFeedCard() {
  const qc = useQueryClient()
  const [rotateOpen, setRotateOpen] = useState(false)

  const feedQuery = useQuery({
    queryKey: qk.icalToken,
    queryFn: getIcalToken,
    staleTime: 60_000,
  })

  const rotateMutation = useMutation({
    mutationFn: rotateIcalToken,
    onSuccess: (data) => {
      qc.setQueryData(qk.icalToken, data)
      void qc.invalidateQueries({ queryKey: qk.icalToken })
      setRotateOpen(false)
      toast.info('Calendar link rotated — re-subscribe your calendars with the new URL.')
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? (error.problem.detail ?? error.problem.title ?? error.message)
          : 'Could not rotate the calendar link. Please try again.',
      )
    },
  })

  return (
    <>
      <SettingsSection
        title="Calendar feed"
        description="Subscribe from Google Calendar, Apple Calendar, or Outlook — events for every task with a due date."
      >
        {feedQuery.isLoading ? (
          <div className="px-4 py-6 text-copy text-text-tertiary">Loading calendar feed…</div>
        ) : feedQuery.data ? (
          <>
            <CopyRow id="ical-feed-https" label="Feed URL" value={feedQuery.data.url} />
            <CopyRow
              id="ical-feed-webcal"
              label="One-click subscribe"
              helper="Opens Apple Calendar or Outlook directly."
              value={feedQuery.data.webcal_url}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="max-w-prose text-caption text-text-tertiary">
                Google Calendar refreshes subscribed feeds roughly every 8–24 hours.
              </p>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setRotateOpen(true)}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Rotate link
              </Button>
            </div>
          </>
        ) : (
          <div className="px-4 py-6 text-copy text-danger">
            Could not load your calendar feed. Reload the page to try again.
          </div>
        )}
      </SettingsSection>

      <RotateConfirm
        open={rotateOpen}
        pending={rotateMutation.isPending}
        onOpenChange={setRotateOpen}
        onConfirm={() => rotateMutation.mutate()}
      />
    </>
  )
}

function CopyRow({
  id,
  label,
  value,
  helper,
}: {
  id: string
  label: string
  value: string
  helper?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Could not copy automatically — select the link and copy it manually.')
    }
  }

  return (
    <div className="grid gap-1.5 px-4 py-3">
      <label htmlFor={id} className="font-medium text-caption text-text-secondary">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-caption"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => void copy()}
          aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        >
          {copied ? (
            <Check size={14} aria-hidden="true" className="text-success" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {helper ? <p className="text-caption text-text-tertiary">{helper}</p> : null}
    </div>
  )
}

function RotateConfirm({
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="w-full max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Rotate calendar link</DialogTitle>
            <DialogDescription>
              Existing calendar subscriptions will stop working. Rotate?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
              Rotate link
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
