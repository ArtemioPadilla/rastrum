import { describe, it, expect } from 'vitest';
import { renderPluginCard, renderLocalDataCard, type PluginCardProps } from '../../src/lib/identifier-card-html';
import type { Identifier } from '../../src/lib/identifiers/types';

const phi: Identifier = {
  id: 'webllm_phi35_vision',
  name: 'Phi-3.5-vision',
  brand: '🧠',
  description: 'Heavy on-device generalist.',
  capabilities: {
    runtime: 'client',
    media: ['photo'],
    taxa: ['*'],
    license: 'free',
    confidence_ceiling: 0.35,
  },
  isAvailable: async () => ({ ready: true }),
  identify: async () => { throw new Error('not used in tests'); },
};

const claude: Identifier = {
  id: 'claude_haiku',
  name: 'Claude Haiku 4.5 (Vision)',
  brand: '✦',
  description: 'Anthropic Claude Haiku 4.5 with vision input.',
  capabilities: {
    runtime: 'server',
    media: ['photo'],
    taxa: ['*'],
    license: 'byo-key',
  },
  keySpec: [{ name: 'anthropic', label: 'Anthropic API key', placeholder: 'sk-ant-…', optional: true }],
  isAvailable: async () => ({ ready: false, reason: 'needs_key' }),
  identify: async () => { throw new Error('not used in tests'); },
};

function props(overrides: Partial<PluginCardProps> = {}): PluginCardProps {
  return {
    lang: 'en',
    plugin: phi,
    state: { kind: 'active' },
    isDisabled: false,
    cacheStatus: { modelId: 'webllm_phi35_vision', cached: true, approxBytes: 4_294_967_296, entries: 15 },
    byoKeysSet: {},
    sponsorship: null,
    ...overrides,
  };
}

describe('renderPluginCard', () => {
  it('renders an active on-device card with name, brand, and Active pill', () => {
    const html = renderPluginCard(props());
    expect(html).toContain('Phi-3.5-vision');
    expect(html).toContain('🧠');
    expect(html).toContain('Active');
    expect(html).toContain('data-toggle-plugin="webllm_phi35_vision"');
    expect(html).toContain('Disable');
  });

  it('renders disabled card with opacity-60 and Enable button', () => {
    const html = renderPluginCard(props({
      state: { kind: 'disabled' }, isDisabled: true,
    }));
    expect(html).toContain('opacity-60');
    expect(html).toContain('Enable');
    expect(html).toContain('Disabled');
    expect(html).not.toMatch(/>Disable<\/button>/);
  });

  it('renders not-downloaded card with primary Download CTA, no Disable toggle', () => {
    const html = renderPluginCard(props({
      state: { kind: 'not-downloaded' },
      cacheStatus: { modelId: 'webllm_phi35_vision', cached: false, approxBytes: 0, entries: 0 },
    }));
    expect(html).toContain('Not downloaded');
    expect(html).toMatch(/Download.*4\.0 GB/);
    // No Disable toggle when nothing to disable
    expect(html).not.toMatch(/data-toggle-plugin/);
  });

  it('renders no-key cloud card with Add key primary button', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'no-key' },
      cacheStatus: null,
    }));
    expect(html).toContain('Claude Haiku');
    expect(html).toContain('No key');
    expect(html).toContain('Add key');
    expect(html).toContain('data-add-key="claude_haiku"');
  });

  it('renders unsupported card with the message inline', () => {
    const html = renderPluginCard(props({
      state: { kind: 'unsupported', reason: 'webgpu', message: 'WebGPU unavailable' },
    }));
    expect(html).toContain('Unsupported');
    expect(html).toContain('WebGPU unavailable');
  });

  it('renders sponsorship chip on Claude card when active', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'active' },
      cacheStatus: null,
      sponsorship: { sponsor_handle: 'alice', daily_limit: 100, used_today: 47 },
    }));
    expect(html).toContain('via sponsorship');
    expect(html).toContain('@alice');
    expect(html).toMatch(/47\s*\/\s*100/);
    expect(html).toContain('Use my own key');
  });

  it('omits the daily count when sponsorship has no limit/usage info', () => {
    const html = renderPluginCard(props({
      plugin: claude,
      state: { kind: 'active' },
      cacheStatus: null,
      sponsorship: { sponsor_handle: 'alice', daily_limit: null, used_today: null },
    }));
    expect(html).toContain('via sponsorship');
    expect(html).toContain('@alice');
    expect(html).not.toMatch(/IDs today/);
  });

  it('escapes HTML in plugin description and sponsor handle', () => {
    const evil: Identifier = { ...phi, description: '<img src=x onerror=alert(1)>', name: '<script>' };
    const html = renderPluginCard(props({
      plugin: evil,
      sponsorship: { sponsor_handle: '<svg>', daily_limit: 1, used_today: 0 },
    }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders downloading state with cancel button and progress pill', () => {
    const html = renderPluginCard(props({
      state: { kind: 'downloading', pct: 42, mb: { current: 1.7, total: 4.0 } },
    }));
    expect(html).toContain('42%');
    expect(html).toContain('id="vision-cancel"');
    expect(html).toContain('Cancel');
  });

  it('renders Spanish strings when lang=es', () => {
    const html = renderPluginCard(props({ lang: 'es' }));
    expect(html).toContain('Activo');
    expect(html).toContain('Desactivar');
  });

  it('renders Spanish cancel and redownload strings when lang=es', () => {
    const downloading = renderPluginCard(props({
      lang: 'es',
      state: { kind: 'downloading', pct: 10, mb: { current: 0.4, total: 4.0 } },
    }));
    expect(downloading).toContain('Cancelar');

    const active = renderPluginCard(props({ lang: 'es' }));
    expect(active).toContain('Volver a descargar');
  });
});

describe('renderLocalDataCard', () => {
  const llamaCached = {
    lang: 'en' as const,
    id: 'llama-3.2-1b',
    name: 'Llama-3.2-1B',
    description: 'Text helper for translation and offline chat. Not part of species identification.',
    brand: '🗨',
    cacheStatus: { modelId: 'llama-3.2-1b', cached: true, approxBytes: 663_000_000, entries: 25 },
    domIdPrefix: 'text',
  };

  it('renders cached state with name + description + delete button', () => {
    const html = renderLocalDataCard(llamaCached);
    expect(html).toContain('Llama-3.2-1B');
    expect(html).toContain('Text helper');
    expect(html).toContain('id="text-delete"');
    expect(html).toContain('id="text-download"');
    // No toggle for non-plugin items
    expect(html).not.toContain('data-toggle-plugin');
    // No sponsorship affordance
    expect(html).not.toContain('via sponsorship');
  });

  it('renders not-cached state with primary Download CTA', () => {
    const html = renderLocalDataCard({
      ...llamaCached,
      cacheStatus: { modelId: 'llama-3.2-1b', cached: false, approxBytes: 0, entries: 0 },
    });
    expect(html).toContain('Download');
    expect(html).not.toContain('id="text-delete"');
  });

  it('escapes user-controlled fields', () => {
    const html = renderLocalDataCard({
      ...llamaCached,
      name: '<script>',
      description: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
