import type { Api } from './types';

// Method → IPC channel. The Electron preload and the browser adapter are both built from this table.
export const API_CHANNELS = {
  loadState: 'state:load',
  saveState: 'state:save',
  listHistory: 'history:list',
  getHistory: 'history:get',
  loadCards: 'cards:load',
  prepareTurn: 'agent:prepare',
  reply: 'agent:reply',
  deepAsk: 'deep:ask',
  deepOptions: 'deep:options',
  teamsText: 'ata:teams',
  saveMinutes: 'ata:save',
  planSpeech: 'voice:plan',
  speakSegment: 'voice:segment',
  cancelSpeech: 'voice:cancel',
  transcribe: 'voice:transcribe',
  voices: 'voice:list',
  copy: 'clipboard:copy',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  continueInClaude: 'claude:continue',
  checkStatus: 'status:check',
  listActions: 'actions:list',
  detectRelease: 'actions:detect',
  previewAction: 'actions:preview',
  approveAction: 'actions:approve',
  freeReleaseCheckout: 'actions:freeBranch',
  skipAction: 'actions:skip',
  conflictAsk: 'actions:conflict',
  conflictFromMr: 'conflict:fromMr',
  conflictPrepare: 'conflict:prepare',
  conflictPropose: 'conflict:propose',
  conflictChoose: 'conflict:choose',
  conflictApply: 'conflict:apply',
  conflictCommit: 'conflict:commit',
  conflictReopen: 'conflict:reopen',
  conflictDiscard: 'conflict:discard',
  gateOptions: 'gate:options',
  startGate: 'gate:start',
  getGate: 'gate:get',
  answerGate: 'gate:answer',
  explainGate: 'gate:explain',
  visualGate: 'gate:visual',
  insertGateVisual: 'gate:insert',
  newGateRound: 'gate:round',
  recordGate: 'gate:record',
  prepareQa: 'qa:prepare',
  getQa: 'qa:get',
  askQa: 'qa:ask',
  writeQaChecklist: 'qa:write',
  prepareRetro: 'retro:prepare',
  latestRetro: 'retro:latest',
  askRetro: 'retro:ask',
} as const satisfies Partial<Record<keyof Api, string>>;

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export function buildApi(invoke: Invoke, onEvent: Api['onEvent'], overrides: Partial<Api> = {}): Api {
  const api: Record<string, unknown> = { invoke };
  for (const [method, channel] of Object.entries(API_CHANNELS)) api[method] = (...args: unknown[]) => invoke(channel, ...args);
  api.onEvent = onEvent;
  return { ...(api as unknown as Api), ...overrides };
}
