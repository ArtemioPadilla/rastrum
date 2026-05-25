/**
 * PBI 4.3 — Chat header badge reflects the user's model choice instead of a
 * hardcoded "Llama 1B". Source-string asserts (no DOM) that ChatView wires the
 * dynamic mapping + the unset fallback string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const chatViewSource = readFileSync(
  resolve(here, '../../src/components/ChatView.astro'),
  'utf8',
);
const enSource = readFileSync(
  resolve(here, '../../src/i18n/en.json'),
  'utf8',
);
const esSource = readFileSync(
  resolve(here, '../../src/i18n/es.json'),
  'utf8',
);

describe('PBI 4.3 — chat badge is dynamic, not hardcoded', () => {
  it('no longer hardcodes "Llama 1B · …" outside the display-name map', () => {
    const hits = chatViewSource.match(/Llama 1B/g) ?? [];
    expect(hits.length).toBe(0);
  });

  it('exposes a MODEL_DISPLAY_NAMES mapping in the script', () => {
    expect(chatViewSource).toMatch(/MODEL_DISPLAY_NAMES/);
  });

  it('reads the engine choice from a stable localStorage key', () => {
    expect(chatViewSource).toMatch(/rastrum\.chat\.engine/);
  });

  it('writes the engine choice when the user clicks a download button', () => {
    expect(chatViewSource).toMatch(/writeChatEngine\('gemma'\)/);
    expect(chatViewSource).toMatch(/writeChatEngine\('llama'\)/);
  });

  it('falls back to "Choose a model" / "Elige un modelo" when no choice exists', () => {
    expect(enSource).toMatch(/"unset":\s*"Choose a model"/);
    expect(esSource).toMatch(/"unset":\s*"Elige un modelo"/);
  });

  it('renders an anchor to the model picker in the unset fallback', () => {
    expect(chatViewSource).toMatch(/href="#chat-consent"/);
  });
});
