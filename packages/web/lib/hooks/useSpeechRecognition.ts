"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// =============================================================================
// Web Speech API type declarations
//
// The SpeechRecognition interfaces are not part of the standard TypeScript DOM
// lib, so we declare the minimal surface we use here. They are vendor-prefixed
// (webkitSpeechRecognition) in Chrome/Safari.
// =============================================================================

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

// Stop listening after this many ms with no new speech results.
const SILENCE_TIMEOUT_MS = 4000

export interface UseSpeechRecognitionOptions {
  /**
   * Called whenever a final (committed) chunk of speech is recognized. Receives
   * the recognized text. Use this to insert the text into an input.
   */
  onResult?: (transcript: string) => void
  /** BCP-47 language tag. Defaults to the browser/document language. */
  lang?: string
  /**
   * Auto-stop after a period of silence. Defaults to true so the mic doesn't
   * stay open indefinitely.
   */
  stopOnSilence?: boolean
}

export interface UseSpeechRecognitionResult {
  /** Whether recognition is currently active. */
  isListening: boolean
  /** Whether the browser supports the Web Speech API. */
  isSupported: boolean
  /** Whether microphone permission has been denied. */
  permissionDenied: boolean
  /** The latest interim (not-yet-final) transcript, for live UI feedback. */
  transcript: string
  /** A human-readable error, if recognition failed. */
  error: string | null
  /** Start listening. No-op if unsupported or already listening. */
  start: () => void
  /** Stop listening. */
  stop: () => void
}

/**
 * Speech-to-text hook built on the browser Web Speech API.
 *
 * Dependency-free — uses `window.SpeechRecognition` /
 * `window.webkitSpeechRecognition`. Feature-detect via the returned
 * `isSupported` and only render UI when it is true.
 *
 * @example
 * ```tsx
 * const { isListening, isSupported, start, stop } = useSpeechRecognition({
 *   onResult: (text) => insertIntoInput(text),
 * })
 * ```
 */
export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionResult {
  const { lang, stopOnSilence = true } = options

  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep the latest onResult callback in a ref so the recognition event
  // handlers (bound once) always call the current closure.
  const onResultRef = useRef(options.onResult)
  onResultRef.current = options.onResult
  // Tracks user intent so we don't fight the engine's own auto-stop.
  const listeningRef = useRef(false)

  // Feature-detect support on mount (client-only).
  useEffect(() => {
    setIsSupported(getSpeechRecognition() !== null)
  }, [])

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    listeningRef.current = false
    clearSilenceTimer()
    recognitionRef.current?.stop()
  }, [clearSilenceTimer])

  const armSilenceTimer = useCallback(() => {
    if (!stopOnSilence) return
    clearSilenceTimer()
    silenceTimerRef.current = setTimeout(() => {
      stop()
    }, SILENCE_TIMEOUT_MS)
  }, [stopOnSilence, clearSilenceTimer, stop])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor || listeningRef.current) return

    setError(null)
    setTranscript("")

    const recognition = new Ctor()
    const docLang = typeof document !== "undefined" ? document.documentElement.lang : ""
    recognition.lang = lang || docLang || "en-US"
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsListening(true)
      armSilenceTimer()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      armSilenceTimer()
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ""
        if (result.isFinal) {
          const finalText = text.trim()
          if (finalText) {
            onResultRef.current?.(finalText)
          }
        } else {
          interim += text
        }
      }
      setTranscript(interim)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setPermissionDenied(true)
        setError("Microphone access was denied.")
      } else if (event.error === "no-speech") {
        // Benign — user didn't say anything before silence/stop.
        setError(null)
      } else if (event.error !== "aborted") {
        setError(`Speech recognition error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      listeningRef.current = false
      clearSilenceTimer()
      setIsListening(false)
      setTranscript("")
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    listeningRef.current = true
    try {
      recognition.start()
    } catch {
      // start() throws if called while already started; reset state.
      listeningRef.current = false
      setIsListening(false)
    }
  }, [lang, armSilenceTimer, clearSilenceTimer])

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      clearSilenceTimer()
      listeningRef.current = false
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [clearSilenceTimer])

  return {
    isListening,
    isSupported,
    permissionDenied,
    transcript,
    error,
    start,
    stop,
  }
}
