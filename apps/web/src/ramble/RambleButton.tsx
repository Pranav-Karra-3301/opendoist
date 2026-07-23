/**
 * Phase 7 (Task J): hold-to-record mic button for the Quick Add action row.
 *
 * Pointer: press-and-hold records, release stops-and-uploads; a quick tap (<300 ms) latches
 * recording until the next tap. Keyboard/a11y: Enter/Space toggles, Escape cancels without
 * uploading, `aria-pressed` reflects the recording state. While recording the button pulses
 * with an accent ring scaled by the live input level and shows an mm:ss timer; on release it
 * uploads (progress bar in place of the timer) and opens the review dialog on success.
 *
 * Disabled with an explanatory tooltip when no speech-to-text provider is configured; while
 * the integrations query is still loading the button stays enabled optimistically.
 */
import { Mic } from 'lucide-react'
import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadRamble, useIntegrations } from '@/api/rambles'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useRambleStore } from '@/ramble/store'
import { toast } from '@/stores/toasts'
import { useRecorder } from './useRecorder'

const TAP_MS = 300
const CONFIGURE_HINT = 'Configure a speech-to-text provider in Settings → Integrations'

type Interaction = 'idle' | 'holding' | 'latched'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function RambleButton() {
  const integrations = useIntegrations()
  const openReview = useRambleStore((s) => s.openReview)
  const reducedMotion = usePrefersReducedMotion()
  const { state, level, elapsedMs, error, start, stop, cancel } = useRecorder()

  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const interactionRef = useRef<Interaction>('idle')
  const downTimeRef = useRef(0)
  const finishingRef = useRef(false)

  // Disabled only once we KNOW the provider is unconfigured; loading → enabled optimistically.
  const disabled = integrations.data?.stt.source === 'none'
  const recording = state === 'recording'
  const requesting = state === 'requesting'
  const pressed = recording || requesting

  const finishAndUpload = useCallback(async () => {
    if (finishingRef.current) return
    finishingRef.current = true
    interactionRef.current = 'idle'
    const result = await stop()
    if (!result) {
      finishingRef.current = false
      return
    }
    setUploading(true)
    setProgress(0)
    try {
      const ramble = await uploadRamble(result.blob, result.mimeType, setProgress)
      openReview(ramble.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
      finishingRef.current = false
    }
  }, [stop, openReview])

  // Safety net for the max-duration auto-stop: the recorder ended on its own while the user
  // still holds/latches → upload the retained take (finishAndUpload is idempotent).
  useEffect(() => {
    if (state === 'idle' && interactionRef.current !== 'idle' && !finishingRef.current) {
      void finishAndUpload()
    }
  }, [state, finishAndUpload])

  // Surface mic-permission / unsupported errors as a toast and reset the interaction.
  useEffect(() => {
    if (error) {
      toast.error(error)
      interactionRef.current = 'idle'
      finishingRef.current = false
    }
  }, [error])

  const beginRecord = useCallback(() => {
    finishingRef.current = false
    void start()
  }, [start])

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || uploading) return
    if (interactionRef.current === 'latched') {
      void finishAndUpload() // second tap stops a latched recording
      return
    }
    if (interactionRef.current !== 'idle') return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    downTimeRef.current = performance.now()
    interactionRef.current = 'holding'
    beginRecord()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (interactionRef.current !== 'holding') return
    const held = performance.now() - downTimeRef.current
    if (e.type === 'pointerup' && held < TAP_MS) {
      interactionRef.current = 'latched' // quick tap → keep recording until the next tap
      return
    }
    void finishAndUpload()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      if (interactionRef.current !== 'idle' || pressed) {
        e.preventDefault()
        e.stopPropagation() // cancel recording without letting the dialog react
        interactionRef.current = 'idle'
        finishingRef.current = false
        cancel()
      }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (disabled || uploading || e.repeat) return
      e.preventDefault() // no page scroll / stray click activation
      if (interactionRef.current === 'idle' && !pressed) {
        interactionRef.current = 'latched' // keyboard has no hold → toggle
        beginRecord()
      } else {
        void finishAndUpload()
      }
    }
  }

  const ringStyle: React.CSSProperties = reducedMotion
    ? { boxShadow: '0 0 0 2px var(--ot-accent)', opacity: 0.6 }
    : {
        boxShadow: '0 0 0 2px var(--ot-accent)',
        transform: `scale(${1 + level * 0.5})`,
        opacity: 0.35 + level * 0.5,
      }

  const liveMessage = uploading ? 'Uploading voice note' : recording ? 'Recording' : ''

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            aria-label="Hold to record a voice note"
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon' }),
              'cursor-not-allowed opacity-50',
            )}
          >
            <Mic size={20} strokeWidth={1.75} aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>{CONFIGURE_HINT}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={pressed ? 'Stop recording' : 'Hold to record a voice note'}
        aria-pressed={pressed}
        title="Hold to record a voice note"
        disabled={uploading}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (interactionRef.current !== 'idle') void finishAndUpload()
        }}
        onKeyDown={onKeyDown}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'relative disabled:opacity-60',
          recording && 'text-accent',
        )}
      >
        {recording && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-sm transition-[transform,opacity] duration-[250ms] ease-standard motion-reduce:transition-none"
            style={ringStyle}
          />
        )}
        <Mic size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {recording && !uploading && (
        <span className="min-w-[2.5rem] font-mono text-caption text-text-secondary tabular-nums">
          {formatElapsed(elapsedMs)}
        </span>
      )}

      {uploading && (
        <div
          className="h-1 w-16 overflow-hidden rounded-full bg-hover"
          role="progressbar"
          aria-label="Uploading voice note"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-150 ease-standard motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  )
}
