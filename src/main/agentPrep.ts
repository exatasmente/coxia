import type { DocsProposal, ProposedDocs, ScanResult } from '../shared/agentPrep';
import type { WorkspaceConfig } from '../shared/config/types';
import { applyDocs, proposeDocs, scanWorkspace, targetsOf } from './agentPrep-core';
import { askAgent, obj, str } from './agents';
import { prompt as cp } from './cyclePrompts';
import { HOME } from './env';
import type { Module } from './module';
import { getConfig, rc, saveConfig, secretConfigured } from './workspaceConfig';

// "Preparar agentes" for the setup wizard and the settings screen: scan the workspace's projects, propose the docs section of the config, apply
// it, and (only when a model provider is ready) ask one cheap call for a one-sentence summary per project. The scan itself uses no model.

const SUMMARY_MAX = 40;

export function scanForWorkspace(): ScanResult {
  const config = getConfig();
  return scanWorkspace(targetsOf(config, HOME), HOME, config.language);
}

export function proposeForWorkspace(scan: ScanResult = scanForWorkspace()): DocsProposal {
  const config = getConfig();
  return proposeDocs(scan, config.docs, HOME, config.language);
}

/** Writes the proposed docs into the workspace config (validated by saveConfig). */
export function applyProposal(docs: ProposedDocs): WorkspaceConfig['docs'] {
  return saveConfig(applyDocs(getConfig(), docs)).docs;
}

/** The "teams" role (the cheap one) has a provider whose key, if it needs one, is on this machine. */
export function canSummarize(): boolean {
  try {
    return secretConfigured(rc().role('teams').secretRef);
  } catch {
    return false;
  }
}

/** One model call that writes a short summary of each project from the facts of the scan (never from files the scan did not already read). */
export async function summarizeScan(scan: ScanResult): Promise<ScanResult> {
  if (!canSummarize()) throw new Error('nenhum provedor de modelo está pronto: configure a chave antes de pedir o resumo');
  const projects = scan.projects.filter((p) => p.exists).slice(0, SUMMARY_MAX);
  if (!projects.length) return scan;
  const facts = projects.map((p) => ({ id: p.id, name: p.name, stack: p.stack, purpose: p.purpose, claudeMd: !!p.claudeMd, skills: p.skills?.count ?? 0, rules: p.rules?.count ?? 0, agents: p.agents?.count ?? 0, knowledge: p.knowledge?.count ?? 0 }));
  const r = await askAgent<{ resumos: { id: string; resumo: string }[] }>(
    'teams',
    cp('agents.summarize', { projects: JSON.stringify(facts) }),
    obj({ resumos: { type: 'array', items: obj({ id: str, resumo: str }) } }),
    { maxTurns: 1 },
  );
  const byId = new Map(r.data.resumos.map((s) => [s.id, s.resumo.trim()]));
  return { ...scan, projects: scan.projects.map((p) => (byId.get(p.id) ? { ...p, modelSummary: byId.get(p.id) } : p)) };
}

export const agentPrep: Module = (ctx) => {
  ctx.handle('agents:scan', () => scanForWorkspace());
  ctx.handle('agents:propose', (scan?: ScanResult) => proposeForWorkspace(scan));
  ctx.handle('agents:apply', (docs: ProposedDocs) => applyProposal(docs));
  ctx.handle('agents:can-summarize', () => canSummarize());
  ctx.handle('agents:summarize', (scan: ScanResult) => summarizeScan(scan));
};
