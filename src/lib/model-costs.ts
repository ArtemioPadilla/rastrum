export interface ModelCostInfo {
  model: string;
  provider: string;
  costPer100Calls: number; // USD
  label: string;
  description_en: string;
  description_es: string;
}

export const MODEL_COSTS: ModelCostInfo[] = [
  { model: 'claude-haiku-4-5', provider: 'anthropic', costPer100Calls: 0.30, label: 'Claude Haiku 4.5', description_en: 'Fast, affordable', description_es: 'Rápido, económico' },
  { model: 'claude-sonnet-4', provider: 'anthropic', costPer100Calls: 1.80, label: 'Claude Sonnet 4', description_en: 'Balanced accuracy', description_es: 'Precisión equilibrada' },
  { model: 'claude-opus-4', provider: 'anthropic', costPer100Calls: 9.00, label: 'Claude Opus 4', description_en: 'Highest accuracy', description_es: 'Máxima precisión' },
  { model: 'gpt-4o-mini', provider: 'openai', costPer100Calls: 0.20, label: 'GPT-4o Mini', description_en: 'Budget OpenAI', description_es: 'OpenAI económico' },
  { model: 'gpt-4o', provider: 'openai', costPer100Calls: 1.50, label: 'GPT-4o', description_en: 'Full OpenAI', description_es: 'OpenAI completo' },
  { model: 'gemini-2.0-flash', provider: 'google', costPer100Calls: 0.10, label: 'Gemini 2.0 Flash', description_en: 'Cheapest option', description_es: 'Opción más económica' },
  { model: 'gemini-2.5-pro', provider: 'google', costPer100Calls: 0.70, label: 'Gemini 2.5 Pro', description_en: 'Google flagship', description_es: 'Insignia de Google' },
];

export function getCostForModel(model: string): ModelCostInfo | undefined {
  return MODEL_COSTS.find(m => m.model === model);
}

export function formatCostBadge(cost: number, lang: 'en' | 'es'): string {
  if (cost < 0.50) return lang === 'es' ? '💚 Económico' : '💚 Budget';
  if (cost < 2.00) return lang === 'es' ? '💛 Moderado' : '💛 Moderate';
  return lang === 'es' ? '🔶 Premium' : '🔶 Premium';
}
