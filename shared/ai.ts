// AI 玩家的模型和推理强度：开局时在大厅选择，记在对局记录里，整局（包括赛后交流）都不能更换

export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1' },
] as const;

export type AIModel = (typeof AI_MODELS)[number]['id'];

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type AIEffort = (typeof AI_EFFORTS)[number];

export const EFFORT_NAME: Record<AIEffort, string> = {
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};

export interface AIConfig {
  model: AIModel;
  effort: AIEffort;
}

export const DEFAULT_AI_CONFIG: AIConfig = { model: 'claude-opus-5-5', effort: 'medium' };

export function isAIConfig(c: unknown): c is AIConfig {
  if (!c || typeof c !== 'object') return false;
  const { model, effort } = c as Record<string, unknown>;
  return AI_MODELS.some((m) => m.id === model) && (AI_EFFORTS as readonly unknown[]).includes(effort);
}

export function modelName(model: AIModel): string {
  return AI_MODELS.find((m) => m.id === model)?.name ?? model;
}

export function describeAIConfig(c: AIConfig): string {
  return `${modelName(c.model)} · 推理强度${EFFORT_NAME[c.effort]}`;
}
