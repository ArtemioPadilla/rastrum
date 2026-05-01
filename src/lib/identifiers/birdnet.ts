/**
 * BirdNET-Lite plugin (client-side via onnxruntime-web).
 *
 * On-device bird-call identifier from the Cornell Lab. Audio in,
 * scientific name out. Runs entirely in the browser:
 *   1. Decode the recorded audio with the Web Audio API.
 *   2. Resample to 48 kHz mono, centre-window 3 s, peak-normalise.
 *   3. Wrap in a Float32 ONNX tensor and run the cached BirdNET-Lite v2.4 session.
 *   4. Map top-K class indices through the labels file.
 *
 * Weights aren't bundled — the user explicitly downloads them once via
 * Profile → Edit → AI settings → BirdNET. After that, identification is
 * fully offline.
 *
 * License: code MIT (this file). Model: CC BY-NC-SA 4.0 (Cornell Lab).
 * Cite: Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET:
 * A deep learning solution for avian diversity monitoring. Ecological
 * Informatics, 61, 101236.
 */
import type { Identifier, IDResult, IdentifyInput } from './types';
import {
  BIRDNET_SAMPLE_RATE, BIRDNET_WINDOW_SAMPLES, BIRDNET_TOP_K,
  parseLabel, buildInputTensor, buildSegmentTensors, topK,
} from './birdnet-audio';
import {
  getBirdNETCacheStatus, getCachedModelBuffer, getCachedLabels,
  getBirdNETWeightsBaseUrl,
} from './birdnet-cache';

const PLUGIN_ID = 'birdnet_lite';

// Module-level caches: don't reload the ONNX session or the labels file
// on every call — both are expensive (~50 MB model parse, ~6,500-line
// label list). The session lives until the page unloads.
type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | unknown }>>;
};
let session: OrtSession | null = null;
let labels: string[] | null = null;

async function ensureSession(): Promise<OrtSession> {
  if (session) return session;
  const buffer = await getCachedModelBuffer();
  if (!buffer) throw new Error('BirdNET model is not cached. Open Profile → Edit → AI settings to download it.');
  const ort = await import('onnxruntime-web');
  // Cast to the runtime InferenceSession shape — the import surface
  // exposes a `create` factory, and we narrow to the methods we use.
  const factory = (ort as unknown as { InferenceSession: { create(buf: ArrayBuffer, opts?: unknown): Promise<OrtSession> } }).InferenceSession;
  session = await factory.create(buffer, { executionProviders: ['wasm'] });
  return session;
}

async function ensureLabels(): Promise<string[]> {
  if (labels) return labels;
  const list = await getCachedLabels();
  if (!list) throw new Error('BirdNET labels are not cached.');
  labels = list;
  return labels;
}

async function decodeAudio(input: IdentifyInput): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  let arrayBuffer: ArrayBuffer;
  if (input.media.kind === 'url') {
    const res = await fetch(input.media.url);
    if (!res.ok) throw new Error(`Audio fetch failed: HTTP ${res.status}`);
    arrayBuffer = await res.arrayBuffer();
  } else if (input.media.kind === 'blob') {
    arrayBuffer = await input.media.blob.arrayBuffer();
  } else {
    arrayBuffer = input.media.bytes.buffer.slice(
      input.media.bytes.byteOffset,
      input.media.bytes.byteOffset + input.media.bytes.byteLength,
    ) as ArrayBuffer;
  }
  const Ctor = (window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API not available in this browser.');
  const ctx = new Ctor({ sampleRate: BIRDNET_SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channels: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));
    return { channels, sampleRate: audio.sampleRate };
  } finally {
    if ('close' in ctx && typeof ctx.close === 'function') {
      ctx.close().catch(() => {});
    }
  }
}

export const birdnetIdentifier: Identifier = {
  id: PLUGIN_ID,
  name: 'BirdNET-Lite (audio)',
  brand: '🐦',
  description: 'Cornell Lab\'s bird-call identifier, run on-device via ONNX. Free for non-commercial use; attribution required.',
  setupSteps: [
    { text: 'Profile → Edit → AI settings → BirdNET-Lite → Download (~50 MB).' },
    { text: 'After download, identification runs entirely on this device — recordings never leave the browser.' },
    {
      text: 'Cite Kahl et al. 2021 if you publish using BirdNET results.',
      link: 'https://doi.org/10.1016/j.ecoinf.2021.101236',
      details: 'BirdNET model is CC BY-NC-SA 4.0 — non-commercial use only.',
    },
  ],
  capabilities: {
    media: ['audio'],
    taxa: ['Animalia.Aves'],
    runtime: 'client',
    license: 'free-nc',
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    if (!getBirdNETWeightsBaseUrl()) {
      return { ready: false, reason: 'model_not_bundled', message: 'PUBLIC_BIRDNET_WEIGHTS_URL is not set.' };
    }
    const status = await getBirdNETCacheStatus();
    if (!status.modelCached || !status.labelsCached) {
      return { ready: false, reason: 'needs_download', message: '~50 MB download (model + labels).' };
    }
    return { ready: true };
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.mediaKind !== 'audio') throw new Error('birdnet_lite: requires mediaKind=audio');
    const onProgress = input.onProgress ?? (() => {});

    onProgress({ progress: 0.05, text: 'Loading BirdNET model…' });
    const [sess, lbls] = await Promise.all([ensureSession(), ensureLabels()]);

    onProgress({ progress: 0.3, text: 'Decoding audio…' });
    const decoded = await decodeAudio(input);

    onProgress({ progress: 0.45, text: 'Segmenting audio…' });
    const ort = await import('onnxruntime-web');
    const TensorCtor = (ort as unknown as { Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown }).Tensor;
    const inputName = sess.inputNames[0] ?? 'input';
    const outputName0 = sess.outputNames[0];

    // Sliding-window inference: 3-s windows with 1.5-s hop (50% overlap).
    // This gives temporal resolution for the spectrogram overlay.
    const segments = buildSegmentTensors(decoded.channels, decoded.sampleRate, 1.5);

    interface SegmentResult {
      startSec: number;
      endSec: number;
      top: Array<{ scientific_name: string; common_name_en: string | null; score: number; label: string }>;
    }
    const segmentResults: SegmentResult[] = [];
    let globalBestScore = 0;
    let globalBestSegIdx = 0;

    for (let i = 0; i < segments.length; i++) {
      onProgress({
        progress: 0.45 + 0.45 * (i / segments.length),
        text: `Identifying segment ${i + 1} / ${segments.length}…`,
      });
      const seg = segments[i];
      const inputTensor = new TensorCtor('float32', seg.tensor, [1, BIRDNET_WINDOW_SAMPLES]);
      const feeds: Record<string, unknown> = { [inputName]: inputTensor };
      const out = await sess.run(feeds);
      const outputName = outputName0 ?? Object.keys(out)[0];
      const scoresRaw = out[outputName]?.data;
      if (!(scoresRaw instanceof Float32Array)) continue;
      const top = topK(scoresRaw, BIRDNET_TOP_K);
      const segTop = top.map(t => ({ label: lbls[t.classIdx] ?? '', score: t.score, ...parseLabel(lbls[t.classIdx] ?? '') }));
      segmentResults.push({ startSec: seg.startSec, endSec: seg.endSec, top: segTop });
      if (segTop[0] && segTop[0].score > globalBestScore) {
        globalBestScore = segTop[0].score;
        globalBestSegIdx = segmentResults.length - 1;
      }
    }

    onProgress({ progress: 0.95, text: 'Reading top predictions…' });

    if (segmentResults.length === 0) throw new Error('BirdNET returned no predictions.');
    const bestSeg = segmentResults[globalBestSegIdx];
    const best = bestSeg.top[0];
    if (!best) throw new Error('BirdNET returned no predictions.');
    const parsed = parseLabel(best.label);

    // Build a deduplicated list of all species detected across segments
    // (for the spectrogram overlay and raw response)
    const allSpeciesMap = new Map<string, { scientific_name: string; common_name_en: string | null; maxScore: number }>();
    for (const seg of segmentResults) {
      for (const c of seg.top) {
        if (!c.scientific_name) continue;
        const existing = allSpeciesMap.get(c.scientific_name);
        if (!existing || c.score > existing.maxScore) {
          allSpeciesMap.set(c.scientific_name, { scientific_name: c.scientific_name, common_name_en: c.common_name_en, maxScore: c.score });
        }
      }
    }
    const allSpecies = [...allSpeciesMap.values()].sort((a, b) => b.maxScore - a.maxScore);

    onProgress({ progress: 1, text: 'Done' });

    return {
      scientific_name: parsed.scientific_name,
      common_name_en: parsed.common_name_en,
      common_name_es: null,
      family: null,
      kingdom: 'Animalia',
      confidence: best.score,
      source: PLUGIN_ID,
      raw: {
        // Legacy field kept for backward compat
        top: bestSeg.top,
        // New: per-segment detection windows with timestamps
        segments: segmentResults,
        // Deduplicated species list across all segments
        allSpecies,
        // Total audio duration in seconds
        durationSec: decoded.channels[0]?.length
          ? decoded.channels[0].length / decoded.sampleRate
          : (segmentResults[segmentResults.length - 1]?.endSec ?? 0),
      },
      warning: 'BirdNET model is licensed CC BY-NC-SA 4.0 (non-commercial). Cite Kahl et al. 2021.',
    };
  },
};
