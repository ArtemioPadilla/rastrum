import { describe, it, expect } from 'vitest';
import {
  isSpeechRecognitionSupported,
  getSpeechRecognitionConstructor,
  speechRecognitionLang,
} from './speech-recognition';

describe('speech-recognition · BCP-47 mapping', () => {
  it('maps locales to MX/US tags', () => {
    expect(speechRecognitionLang('es')).toBe('es-MX');
    expect(speechRecognitionLang('en')).toBe('en-US');
  });
});

describe('speech-recognition · feature detection', () => {
  it('isSpeechRecognitionSupported is false on a vanilla undefined window', () => {
    expect(isSpeechRecognitionSupported(undefined)).toBe(false);
  });

  it('detects vendor-prefixed constructor on a synthetic window', () => {
    class Stub extends EventTarget {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      onstart = null;
      start() { /* noop */ }
      stop() { /* noop */ }
      abort() { /* noop */ }
    }
    const fakeWindow = { webkitSpeechRecognition: Stub } as unknown as Window;
    expect(getSpeechRecognitionConstructor(fakeWindow)).toBe(Stub);
    expect(isSpeechRecognitionSupported(fakeWindow)).toBe(true);
  });
});
