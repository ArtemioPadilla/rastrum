/**
 * Curated, capability-framed download catalog (#1127). The user-facing
 * chooser is built from this; the raw identifier registry is "Advanced".
 * Sizes are approximate MB for the data-cost warning + live total.
 */
export interface CapabilityItem {
  /** Stable id used for selection state + to find the matching registry card. */
  id: string;
  /** Registry plugin id whose existing Download control this drives, or 'offline-map'. */
  target: string;
  labelEn: string;
  labelEs: string;
  capabilityEn: string;
  capabilityEs: string;
  sizeMb: number;
  /** Pre-checked when the user has never chosen (sane default). */
  defaultChecked: boolean;
  /** Lives under the collapsed "Advanced · powerful devices" subgroup. */
  advanced: boolean;
}

export const CAPABILITY_CATALOG: readonly CapabilityItem[] = [
  { id: 'efficientnet', target: 'onnx_efficientnet_lite0', labelEn: 'EfficientNet', labelEs: 'EfficientNet', capabilityEn: 'Plants & general species, on-device', capabilityEs: 'Plantas y especies generales, en el dispositivo', sizeMb: 18, defaultChecked: true, advanced: false },
  { id: 'birdnet', target: 'birdnet_lite', labelEn: 'BirdNET', labelEs: 'BirdNET', capabilityEn: 'Bird songs & calls, on-device', capabilityEs: 'Cantos y llamados de aves, en el dispositivo', sizeMb: 50, defaultChecked: true, advanced: false },
  { id: 'megadetector', target: 'camera_trap_megadetector', labelEn: 'MegaDetector', labelEs: 'MegaDetector', capabilityEn: 'Camera-trap animal detection, on-device', capabilityEs: 'Detección de fauna en cámaras-trampa, en el dispositivo', sizeMb: 134, defaultChecked: false, advanced: false },
  { id: 'offline-map', target: 'offline-map', labelEn: 'Offline map', labelEs: 'Mapa sin conexión', capabilityEn: 'Map tiles for field use without signal', capabilityEs: 'Mapas para el campo sin señal', sizeMb: 120, defaultChecked: false, advanced: false },
  { id: 'phi', target: 'webllm_phi35_vision', labelEn: 'Phi-3.5 Vision', labelEs: 'Phi-3.5 Visión', capabilityEn: 'On-device LLM vision (powerful devices)', capabilityEs: 'Visión LLM en el dispositivo (equipos potentes)', sizeMb: 4096, defaultChecked: false, advanced: true },
  { id: 'gemma', target: 'onnx_gemma4_vision', labelEn: 'Gemma Vision', labelEs: 'Gemma Visión', capabilityEn: 'On-device LLM vision (powerful devices)', capabilityEs: 'Visión LLM en el dispositivo (equipos potentes)', sizeMb: 3277, defaultChecked: false, advanced: true },
];

/** Items whose target plugin is unavailable are simply not offered (capability-graph degrade, no errors). 'offline-map' is always kept. */
export function degradeCatalog(catalog: readonly CapabilityItem[], availableTargets: ReadonlySet<string>): CapabilityItem[] {
  return catalog.filter((c) => c.target === 'offline-map' || availableTargets.has(c.target));
}

export function defaultSelection(catalog: readonly CapabilityItem[]): string[] {
  return catalog.filter((c) => c.defaultChecked).map((c) => c.id);
}

export function liveTotalMb(catalog: readonly CapabilityItem[], selectedIds: readonly string[]): number {
  const sel = new Set(selectedIds);
  return catalog.reduce((sum, c) => (sel.has(c.id) ? sum + c.sizeMb : sum), 0);
}

/** Human total: ">1024 MB → N.N GB" else "NNN MB". */
export function formatSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Large-item data-cost warning threshold (MB). */
export const LARGE_ITEM_MB = 100;
