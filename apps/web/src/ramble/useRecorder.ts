/**
 * Phase 7 (Task J): microphone capture hook for Ramble.
 *
 * Wraps `MediaRecorder` with a live input-level meter (`AudioContext` + `AnalyserNode`),
 * an elapsed timer, and a hard max-duration guard. The mic pick order and 1 s timeslice
 * follow the dossier §5.7 capture snippet; every piece of audio machinery is torn down on
 * stop / cancel / unmount so the browser's "recording" indicator never leaks.
 *
 * `stop()` resolves with the recorded take (or `null` when cancelled / nothing captured).
 * The max-duration timer stops the recorder on the same code path as a manual stop, leaving
 * the finished take retrievable through a subsequent `stop()` call (see `RambleButton`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'error'

export interface RecorderResult {
  blob: Blob
  mimeType: string
}

export interface UseRecorderOptions {
  maxDurationMs?: number
}

export interface Recorder {
  state: RecorderState
  /** normalized RMS input level, 0..1, updated ~15 fps while recording */
  level: number
  elapsedMs: number
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<RecorderResult | null>
  cancel: () => void
}

const DEFAULT_MAX_DURATION_MS = 600_000 // 10 minutes
const ELAPSED_TICK_MS = 250
const LEVEL_INTERVAL_MS = 66 // ~15 fps
const AUDIO_BITS_PER_SECOND = 48_000

/** Mime pick order per dossier §5.7 — webm/opus first, mp4 (older Safari) fallback. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'] as const

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

function micErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return 'Microphone access was blocked. Enable it in your browser settings and try again.'
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      return 'No microphone was found.'
    }
    if (err.name === 'NotReadableError') {
      return 'Your microphone is already in use by another app.'
    }
  }
  return 'Could not access the microphone.'
}

export function useRecorder(opts: UseRecorderOptions = {}): Recorder {
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS

  const [state, setState] = useState<RecorderState>('idle')
  const [level, setLevel] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Mutable recording machinery (kept in refs so it survives re-renders untouched).
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelTickRef = useRef(0)
  const startTimeRef = useRef(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopResolveRef = useRef<((result: RecorderResult | null) => void) | null>(null)
  const lastResultRef = useRef<RecorderResult | null>(null)
  const cancelledRef = useRef(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  const stopStream = useCallback(() => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
  }, [])

  const teardownMeterAndTimers = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const ctx = audioCtxRef.current
    if (ctx) {
      void ctx.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    analyserRef.current = null
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    // Best-effort: a metering failure must never break the actual recording.
    try {
      if (typeof AudioContext === 'undefined') return
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser
      levelTickRef.current = 0
      const loop = () => {
        const node = analyserRef.current
        if (!node) return
        const now = performance.now()
        if (now - levelTickRef.current >= LEVEL_INTERVAL_MS) {
          levelTickRef.current = now
          const buf = new Uint8Array(node.fftSize)
          node.getByteTimeDomainData(buf)
          let sumSquares = 0
          for (const sample of buf) {
            const centered = (sample - 128) / 128
            sumSquares += centered * centered
          }
          setLevel(Math.min(1, Math.sqrt(sumSquares / buf.length)))
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch {
      /* metering unavailable; recording continues without a level indicator */
    }
  }, [])

  const finalizeStop = useCallback(() => {
    teardownMeterAndTimers()
    stopStream()
    const chunks = chunksRef.current
    chunksRef.current = []
    const rec = recorderRef.current
    const mimeType = rec?.mimeType || pickMimeType() || 'audio/webm'
    recorderRef.current = null
    busyRef.current = false
    setState('idle')
    setLevel(0)
    const resolve = stopResolveRef.current
    stopResolveRef.current = null
    if (cancelledRef.current) {
      cancelledRef.current = false
      lastResultRef.current = null
      resolve?.(null)
      return
    }
    const result: RecorderResult = { blob: new Blob(chunks, { type: mimeType }), mimeType }
    if (resolve) resolve(result)
    else lastResultRef.current = result // auto-stopped with no awaiting caller
  }, [teardownMeterAndTimers, stopStream])

  const start = useCallback(async (): Promise<void> => {
    if (busyRef.current) return
    if (
      typeof MediaRecorder === 'undefined' ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setState('error')
      setError('Voice recording is not supported in this browser.')
      return
    }
    busyRef.current = true
    cancelledRef.current = false
    chunksRef.current = []
    lastResultRef.current = null
    setError(null)
    setState('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      busyRef.current = false
      setState('error')
      setError(micErrorMessage(err))
      return
    }
    // Bail if the component unmounted or the user cancelled during the permission prompt.
    if (!mountedRef.current || cancelledRef.current) {
      for (const track of stream.getTracks()) track.stop()
      busyRef.current = false
      cancelledRef.current = false
      return
    }
    streamRef.current = stream

    const mimeType = pickMimeType()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(
        stream,
        mimeType
          ? { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
          : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND },
      )
    } catch {
      stopStream()
      busyRef.current = false
      setState('error')
      setError('Could not start recording.')
      return
    }
    recorderRef.current = rec
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => finalizeStop()
    try {
      rec.start(1000) // 1 s timeslice → data survives a mid-recording tab crash
    } catch {
      recorderRef.current = null
      stopStream()
      busyRef.current = false
      setState('error')
      setError('Could not start recording.')
      return
    }

    setState('recording')
    startMeter(stream)
    startTimeRef.current = performance.now()
    setElapsedMs(0)
    elapsedTimerRef.current = setInterval(() => {
      setElapsedMs(performance.now() - startTimeRef.current)
    }, ELAPSED_TICK_MS)
    maxTimerRef.current = setTimeout(() => {
      // Auto-stop on the same path as a manual stop; the finished take is retained
      // for the next stop() call (no awaiting resolver here).
      const active = recorderRef.current
      if (active && active.state !== 'inactive') {
        try {
          active.stop()
        } catch {
          /* already inactive */
        }
      }
    }, maxDurationMs)
  }, [maxDurationMs, startMeter, finalizeStop, stopStream])

  const stop = useCallback((): Promise<RecorderResult | null> => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      return new Promise<RecorderResult | null>((resolve) => {
        stopResolveRef.current = resolve
        try {
          rec.stop() // → onstop → finalizeStop resolves this promise
        } catch {
          stopResolveRef.current = null
          resolve(null)
        }
      })
    }
    // Already stopped (e.g. by the max-duration timer) — hand back the retained take once.
    const stored = lastResultRef.current
    lastResultRef.current = null
    return Promise.resolve(stored)
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop() // → onstop → finalizeStop discards (cancelledRef)
      } catch {
        /* fall through to synchronous cleanup */
      }
      return
    }
    teardownMeterAndTimers()
    stopStream()
    chunksRef.current = []
    lastResultRef.current = null
    cancelledRef.current = false
    busyRef.current = false
    setState('idle')
    setLevel(0)
  }, [teardownMeterAndTimers, stopStream])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          /* already inactive */
        }
      }
      teardownMeterAndTimers()
      stopStream()
    }
  }, [teardownMeterAndTimers, stopStream])

  return { state, level, elapsedMs, error, start, stop, cancel }
}
