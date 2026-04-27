import { describe, it, expect, vi } from 'vitest';
import {
  runParallelIdentify,
  parseVisionJson,
  extractJsonObject,
  filterRunnersByHint,
  type IdentifierRunner,
  type UnifiedIdResult,
} from './identify-cascade-client';

const fakeFile = new File([new Uint8Array([0])], 'test.jpg', { type: 'image/jpeg' });

function makeResult(over: Partial<UnifiedIdResult> = {}): UnifiedIdResult {
  return {
    source: 'plantnet',
    scientific_name: 'Quercus ilex',
    common_name: 'Holm oak',
    confidence: 0.82,
    alternates: [],
    ...over,
  };
}

function delayed<T>(ms: number, val: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(val), ms));
}

describe('runParallelIdentify', () => {
  it('PlantNet wins when it returns first with high confidence', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => makeResult({ source: 'plantnet', confidence: 0.9 }));
    const claude: IdentifierRunner = vi.fn(async () => delayed(50, makeResult({ source: 'claude_haiku', confidence: 0.7 })));
    const out = await runParallelIdentify(fakeFile, { runners: { plantnet, claude_haiku: claude } });
    expect(out.kind).toBe('winner');
    if (out.kind === 'winner') {
      expect(out.result.source).toBe('plantnet');
      expect(out.uncertain).toBe(false);
    }
  });

  it('Claude wins when PlantNet returns low confidence and Claude returns high', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => makeResult({ source: 'plantnet', confidence: 0.2 }));
    const claude: IdentifierRunner = vi.fn(async () => delayed(20, makeResult({ source: 'claude_haiku', confidence: 0.85 })));
    const out = await runParallelIdentify(fakeFile, { runners: { plantnet, claude_haiku: claude } });
    expect(out.kind).toBe('winner');
    if (out.kind === 'winner') {
      expect(out.result.source).toBe('claude_haiku');
    }
  });

  it('Phi wins when others fail', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => { throw new Error('PlantNet 404'); });
    const claude: IdentifierRunner = vi.fn(async () => null);
    const phi: IdentifierRunner = vi.fn(async () => makeResult({ source: 'webllm_phi35_vision', confidence: 0.6 }));
    const out = await runParallelIdentify(fakeFile, {
      runners: { plantnet, claude_haiku: claude, webllm_phi35_vision: phi },
    });
    expect(out.kind).toBe('winner');
    if (out.kind === 'winner') {
      expect(out.result.source).toBe('webllm_phi35_vision');
    }
  });

  it('returns all_failed when every runner errors', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => { throw new Error('PlantNet down'); });
    const claude: IdentifierRunner = vi.fn(async () => { throw new Error('Anthropic 500'); });
    const out = await runParallelIdentify(fakeFile, { runners: { plantnet, claude_haiku: claude } });
    expect(out.kind).toBe('all_failed');
    if (out.kind === 'all_failed') {
      expect(out.errors.plantnet).toContain('PlantNet down');
      expect(out.errors.claude_haiku).toContain('Anthropic 500');
    }
  });

  it('returns uncertain with highest-confidence result when nothing crosses the threshold', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => makeResult({ source: 'plantnet', confidence: 0.2 }));
    const claude: IdentifierRunner = vi.fn(async () => makeResult({ source: 'claude_haiku', confidence: 0.4 }));
    const out = await runParallelIdentify(fakeFile, { runners: { plantnet, claude_haiku: claude } });
    expect(out.kind).toBe('uncertain');
    if (out.kind === 'uncertain') {
      expect(out.result.source).toBe('claude_haiku');
      expect(out.uncertain).toBe(true);
    }
  });

  it('aborts pending runners when a winner is decided', async () => {
    let abortedSignal: AbortSignal | null = null;
    const plantnet: IdentifierRunner = vi.fn(async () => makeResult({ source: 'plantnet', confidence: 0.9 }));
    const slowClaude: IdentifierRunner = vi.fn(async (_f, signal) => {
      abortedSignal = signal;
      // Listen for abort and resolve null
      return new Promise<UnifiedIdResult | null>((resolve) => {
        signal.addEventListener('abort', () => resolve(null));
        setTimeout(() => resolve(makeResult({ source: 'claude_haiku', confidence: 0.95 })), 200);
      });
    });
    const out = await runParallelIdentify(fakeFile, {
      runners: { plantnet, claude_haiku: slowClaude },
    });
    expect(out.kind).toBe('winner');
    if (out.kind === 'winner') expect(out.result.source).toBe('plantnet');
    expect(abortedSignal).not.toBeNull();
    expect(abortedSignal!.aborted).toBe(true);
  });

  it('honours an external AbortSignal', async () => {
    const ctrl = new AbortController();
    const plantnet: IdentifierRunner = vi.fn(async (_f, signal) =>
      new Promise<UnifiedIdResult | null>((resolve) => {
        signal.addEventListener('abort', () => resolve(null));
        setTimeout(() => resolve(makeResult({ confidence: 0.9 })), 200);
      }),
    );
    const promise = runParallelIdentify(fakeFile, { runners: { plantnet } }, ctrl.signal);
    ctrl.abort();
    const out = await promise;
    expect(out.kind).toBe('all_failed');
  });

  it('returns all_failed when no runners are supplied', async () => {
    const out = await runParallelIdentify(fakeFile, { runners: {} });
    expect(out.kind).toBe('all_failed');
  });
});

describe('filterRunnersByHint', () => {
  const noopRunner: IdentifierRunner = async () => null;
  const runners = {
    plantnet: noopRunner,
    claude_haiku: noopRunner,
    webllm_phi35_vision: noopRunner,
  };

  it('returns the runner set unchanged when no hint is supplied', () => {
    const out = filterRunnersByHint(runners, null);
    expect(Object.keys(out).sort()).toEqual(['claude_haiku', 'plantnet', 'webllm_phi35_vision']);
  });

  it('keeps PlantNet for the plant hint', () => {
    const out = filterRunnersByHint(runners, 'Plantae');
    expect(Object.keys(out)).toContain('plantnet');
    expect(Object.keys(out)).toContain('claude_haiku');
  });

  it('drops PlantNet for the bird hint', () => {
    const out = filterRunnersByHint(runners, 'Animalia.Aves');
    expect(Object.keys(out)).not.toContain('plantnet');
    expect(Object.keys(out)).toContain('claude_haiku');
    expect(Object.keys(out)).toContain('webllm_phi35_vision');
  });

  it('drops PlantNet for the mammal hint', () => {
    const out = filterRunnersByHint(runners, 'Animalia.Mammalia');
    expect(Object.keys(out)).not.toContain('plantnet');
  });

  it('drops PlantNet for the insect hint', () => {
    const out = filterRunnersByHint(runners, 'Animalia.Insecta');
    expect(Object.keys(out)).not.toContain('plantnet');
  });

  it('drops PlantNet for the fungus hint', () => {
    const out = filterRunnersByHint(runners, 'Fungi');
    expect(Object.keys(out)).not.toContain('plantnet');
  });
});

describe('runParallelIdentify with taxonHint', () => {
  it('skips PlantNet entirely when given a bird hint, even if PlantNet would have won', async () => {
    const plantnet: IdentifierRunner = vi.fn(async () => makeResult({ source: 'plantnet', confidence: 0.95 }));
    const claude: IdentifierRunner = vi.fn(async () => makeResult({ source: 'claude_haiku', confidence: 0.6 }));
    const out = await runParallelIdentify(fakeFile, {
      runners: { plantnet, claude_haiku: claude },
      taxonHint: 'Animalia.Aves',
    });
    expect(plantnet).not.toHaveBeenCalled();
    expect(out.kind).toBe('winner');
    if (out.kind === 'winner') expect(out.result.source).toBe('claude_haiku');
  });
});

describe('extractJsonObject', () => {
  it('strips a ```json fence', () => {
    const out = extractJsonObject('```json\n{"top":"X"}\n```');
    expect(out).toBe('{"top":"X"}');
  });

  it('extracts the first JSON object from a prose preamble', () => {
    const out = extractJsonObject('Here is the answer: {"top":"X","note":"y"} thanks');
    expect(out).toBe('{"top":"X","note":"y"}');
  });

  it('returns null on empty/garbage', () => {
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject('no json here')).toBeNull();
  });
});

describe('parseVisionJson', () => {
  it('parses Claude-style JSON with top + alternates', () => {
    const raw = '{"top":"Quercus ilex","common":"Holm oak","confidence":0.82,"alternates":[{"sci":"Quercus suber","common":"Cork oak","score":0.10}],"note":"a fact"}';
    const parsed = parseVisionJson(raw);
    expect(parsed?.scientific_name).toBe('Quercus ilex');
    expect(parsed?.common_name).toBe('Holm oak');
    expect(parsed?.confidence).toBe(0.82);
    expect(parsed?.alternates[0].scientific_name).toBe('Quercus suber');
    expect(parsed?.alternates[0].score).toBe(0.10);
    expect(parsed?.note).toBe('a fact');
  });

  it('parses Phi-style JSON with scientific_name + notes', () => {
    const raw = '{"scientific_name":"Panthera onca","common_name_en":"Jaguar","notes":"large cat"}';
    const parsed = parseVisionJson(raw);
    expect(parsed?.scientific_name).toBe('Panthera onca');
    expect(parsed?.common_name).toBe('Jaguar');
    expect(parsed?.note).toBe('large cat');
  });

  it('returns null when no JSON is present', () => {
    expect(parseVisionJson('I cannot identify this photo.')).toBeNull();
  });

  it('returns null when JSON has no top/scientific_name', () => {
    expect(parseVisionJson('{"note":"unsure"}')).toBeNull();
  });

  it('clamps confidence into [0,1]', () => {
    const high = parseVisionJson('{"top":"X","confidence":1.5}');
    expect(high?.confidence).toBe(1);
    const low = parseVisionJson('{"top":"X","confidence":-0.2}');
    expect(low?.confidence).toBe(0);
    const nan = parseVisionJson('{"top":"X","confidence":"oops"}');
    expect(nan?.confidence).toBe(0);
  });
});
