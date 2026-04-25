import { describe, it, expect } from 'vitest';
import {
  detectLocaleFromDoc,
  flipLocale,
  languageName,
  buildTranslatePrompt,
  buildNarrativePrompt,
  compactFields,
  CHAT_SYSTEM_PROMPT,
  isIOS,
} from './local-ai-helpers';

describe('local-ai-helpers · locale detection', () => {
  it('flipLocale returns the opposite', () => {
    expect(flipLocale('en')).toBe('es');
    expect(flipLocale('es')).toBe('en');
  });

  it('languageName maps to the prompt-friendly form', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('es')).toBe('Spanish');
  });

  it('detectLocaleFromDoc reads <html lang>', () => {
    const make = (lang: string) => {
      const d = document.implementation.createHTMLDocument('t');
      d.documentElement.setAttribute('lang', lang);
      return d;
    };
    expect(detectLocaleFromDoc(make('es'))).toBe('es');
    expect(detectLocaleFromDoc(make('es-MX'))).toBe('es');
    expect(detectLocaleFromDoc(make('en'))).toBe('en');
    expect(detectLocaleFromDoc(make('en-US'))).toBe('en');
    expect(detectLocaleFromDoc(make(''))).toBe('en');
    expect(detectLocaleFromDoc(null)).toBe('en');
  });
});

describe('local-ai-helpers · translate prompt', () => {
  it('uses both language names and forbids preamble', () => {
    const p = buildTranslatePrompt('en', 'es');
    expect(p).toContain('English');
    expect(p).toContain('Spanish');
    expect(p).toContain('Latin');
    expect(p).toContain('no preamble');
  });

  it('flips direction for ES → EN', () => {
    const p = buildTranslatePrompt('es', 'en');
    // 'from Spanish to English' — order matters, since the model otherwise produces a no-op
    expect(p.indexOf('Spanish')).toBeLessThan(p.indexOf('English'));
  });
});

describe('local-ai-helpers · narrative prompt', () => {
  it('embeds JSON of the supplied fields', () => {
    const p = buildNarrativePrompt('en', { species_guess: 'Quetzalus mocinno', count: 1 });
    expect(p).toContain('Quetzalus mocinno');
    expect(p).toContain('"count":1');
    expect(p).toContain('English');
    expect(p).toContain('field naturalist');
    expect(p).toContain('Do not invent');
  });

  it('drops null/empty fields rather than asking the model to fabricate', () => {
    const p = buildNarrativePrompt('es', {
      species_guess: 'Bombus ephippiatus',
      habitat: '',
      behavior_tags: [],
      count: null,
      weather: 'sunny',
    });
    expect(p).toContain('Bombus ephippiatus');
    expect(p).toContain('sunny');
    expect(p).not.toContain('habitat');
    expect(p).not.toContain('behavior_tags');
    expect(p).not.toContain('count');
    expect(p).toContain('Spanish');
  });

  it('compactFields strips falsy entries by type', () => {
    expect(compactFields({
      species_guess: '',
      count: 0,
      behavior_tags: ['flight'],
      time: null,
    })).toEqual({ count: 0, behavior_tags: ['flight'] });
  });
});

describe('local-ai-helpers · chat system prompt', () => {
  it('mentions Rastrum and bilingual mirroring', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Rastrum');
    expect(CHAT_SYSTEM_PROMPT).toMatch(/English/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Spanish/);
  });
});

describe('local-ai-helpers · iOS detection', () => {
  it('matches iPhone/iPad/iPod', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIOS('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIOS('Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)')).toBe(true);
  });

  it('non-iOS UAs are excluded', () => {
    expect(isIOS('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe(false);
    expect(isIOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(false);
    expect(isIOS('')).toBe(false);
  });
});
