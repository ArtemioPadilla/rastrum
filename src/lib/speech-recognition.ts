/**
 * Thin wrapper around the (still-vendor-prefixed) Web Speech API.
 *
 * The DOM lib in TypeScript 5.x doesn't yet declare `SpeechRecognition` —
 * we keep the structural types here, narrow at the call site, and expose a
 * pair of helpers (`isSpeechRecognitionSupported`, `createSpeechRecognition`)
 * the chat composer uses. No external dependency.
 */

export interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
  onstart: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechCapableWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function getSpeechRecognitionConstructor(
  win: SpeechCapableWindow | undefined = typeof window === 'undefined' ? undefined : (window as SpeechCapableWindow),
): SpeechRecognitionConstructor | null {
  if (!win) return null;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(
  win: SpeechCapableWindow | undefined = typeof window === 'undefined' ? undefined : (window as SpeechCapableWindow),
): boolean {
  return getSpeechRecognitionConstructor(win) !== null;
}

/**
 * Construct a configured `SpeechRecognition` instance, or `null` if the
 * browser doesn't expose one. Caller is responsible for wiring listeners
 * and calling `.start()`.
 */
export function createSpeechRecognition(opts: { lang: string; continuous?: boolean; interimResults?: boolean }):
  SpeechRecognitionLike | null {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = opts.continuous ?? true;
  rec.interimResults = opts.interimResults ?? true;
  rec.maxAlternatives = 1;
  return rec;
}

/** Map our app locales to the BCP-47 tags Web Speech accepts. */
export function speechRecognitionLang(locale: 'en' | 'es'): string {
  return locale === 'es' ? 'es-MX' : 'en-US';
}
