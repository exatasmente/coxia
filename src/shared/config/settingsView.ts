import type { Settings, WebSettings } from '../settings';
import { LLM_ROLES, type LlmRole, type WorkspaceConfig } from './types';

// "Settings" is the flat view the Settings screen and many modules have always used. It is no longer stored: it is derived from the
// workspace config (and the shared web.json), and a save is applied back onto the config. The config holds more than this view shows.

export function settingsFromConfig(c: WorkspaceConfig, web: WebSettings): Settings {
  const models = Object.fromEntries(LLM_ROLES.map((r) => [r, c.llm.roles[r].model])) as Record<LlmRole, string>;
  const options = [...new Set(c.llm.providers.flatMap((p) => p.models))];
  return {
    language: c.language,
    models,
    modelOptions: options,
    tools: { files: c.agents.tools.files, skills: c.agents.tools.skills, gitlabMcp: c.agents.tools.trackerMcp, glab: c.agents.tools.vcsCli, subagents: c.agents.tools.subagents },
    schedule: { ...c.schedule },
    voice: { enabled: c.voice.enabled, depsInstalled: c.voice.depsInstalled, sttModel: c.voice.sttModel, autoStop: c.voice.autoStop, silenceMs: c.voice.silenceMs, speak: c.voice.speak, engine: c.voice.engine, prosody: c.voice.prosody, bargeIn: c.voice.bargeIn },
    notifications: c.notifications,
    closeToTray: c.closeToTray,
    retention: { ...c.retention },
    appearance: { ...c.appearance },
    web,
  };
}

/** Writes a saved Settings back onto the config; fields the view does not carry keep their value. The web block is not part of the config. */
export function applySettings(c: WorkspaceConfig, s: Settings): WorkspaceConfig {
  return {
    ...c,
    language: s.language,
    llm: { ...c.llm, roles: Object.fromEntries(LLM_ROLES.map((r) => [r, { ...c.llm.roles[r], model: s.models[r] }])) as WorkspaceConfig['llm']['roles'] },
    agents: { ...c.agents, tools: { ...c.agents.tools, files: s.tools.files, skills: s.tools.skills, trackerMcp: s.tools.gitlabMcp, vcsCli: s.tools.glab, subagents: s.tools.subagents } },
    schedule: { ...s.schedule },
    voice: { ...c.voice, autoStop: s.voice.autoStop, silenceMs: s.voice.silenceMs, speak: s.voice.speak, engine: s.voice.engine, prosody: s.voice.prosody, bargeIn: s.voice.bargeIn },
    notifications: s.notifications,
    closeToTray: s.closeToTray,
    retention: { ...s.retention },
    appearance: { ...s.appearance },
  };
}
