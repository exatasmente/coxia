export type ModelRole = 'turn' | 'reply' | 'deep' | 'teams';

export interface Settings {
  models: Record<ModelRole, string>;
  tools: {
    files: boolean;
    skills: boolean;
    gitlabMcp: boolean;
    glab: boolean;
    subagents: boolean;
  };
  schedule: {
    preDaily: string;
    days: number[];
    statusEveryMin: number;
    from: string;
    to: string;
    retroDay: number;
    retroTime: string;
  };
  voice: { autoStop: boolean; silenceMs: number; speak: boolean; engine: 'edge' | 'kokoro' };
  notifications: boolean;
  closeToTray: boolean;
}

export const MODEL_OPTIONS = ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro-0813', 'qwen/qwen3.7-flash'];

export const DEFAULT_SETTINGS: Settings = {
  models: {
    turn: 'deepseek/deepseek-v4.1-flash',
    reply: 'deepseek/deepseek-v4.1-flash',
    deep: 'deepseek/deepseek-v4.1-flash',
    teams: 'deepseek/deepseek-v4.1-flash',
  },
  tools: { files: true, skills: true, gitlabMcp: true, glab: true, subagents: true },
  schedule: { preDaily: '09:40', days: [1, 2, 3, 4, 5], statusEveryMin: 30, from: '08:00', to: '19:00', retroDay: 5, retroTime: '16:00' },
  voice: { autoStop: true, silenceMs: 1200, speak: true, engine: 'edge' },
  notifications: true,
  closeToTray: true,
};

export function withDefaults(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    models: { ...DEFAULT_SETTINGS.models, ...p.models },
    tools: { ...DEFAULT_SETTINGS.tools, ...p.tools },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...p.schedule },
    voice: { ...DEFAULT_SETTINGS.voice, ...p.voice },
    notifications: p.notifications ?? DEFAULT_SETTINGS.notifications,
    closeToTray: p.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
  };
}
