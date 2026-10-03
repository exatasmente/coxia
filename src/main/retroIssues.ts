import { t } from '../shared/i18n';
import type { Retro, VcsCommand } from '../shared/types';
import { proposeVcsAction } from './actions';
import { formatDate, formatTime } from './cyclePrompts';
import { redact } from './errorlog-core';
import { readRetro, writeRetro } from './retro';
import { vcsProvider } from './vcs';
import { issueProjectKey } from './workspaceConfig';

// An improvement the retro's conversation raised, as the model answers it.
export interface RetroImprovement {
  titulo: string;
  dimensao: string;
  problema: string;
  proposta: string;
}

/** A failure short enough to be spoken, with anything secret taken out first: it ends up in the retro's conversation. */
export const failureText = (e: unknown): string => redact(e instanceof Error ? e.message : String(e)).slice(0, 300);

const now = (): string => formatTime(new Date());

// What makes two improvements of the same retro the same proposal: a title written the same way twice must not become two issues.
const slug = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

// Why this improvement cannot become an issue right now, or the commands that would create it: no host, no issue write, no issue project, or a title the host refuses.
async function planned(m: RetroImprovement, body: string): Promise<{ reason: string } | { commands: VcsCommand[] }> {
  let provider;
  try {
    provider = vcsProvider();
  } catch (e) {
    return { reason: failureText(e) };
  }
  if (!provider.caps.issues) return { reason: t('main.retro.issue.noWrite') };
  let project: string;
  try {
    project = issueProjectKey();
  } catch (e) {
    return { reason: failureText(e) };
  }
  try {
    const commands = await provider.planWrite({ op: 'createIssue', project, title: m.titulo, body, labels: [] });
    return commands.length ? { commands } : { reason: t('main.retro.issue.noWrite') };
  } catch (e) {
    return { reason: failureText(e) };
  }
}

/**
 * Turns the improvements the retro's conversation raised into proposals in Actions, one per improvement, in the order they came. Nothing is written on the
 * tracker here: each proposal waits for the person's "yes". When the workspace cannot write an issue at all, the improvement stays in the conversation with
 * the reason said.
 */
export async function proposeRetroIssues(retro: Retro, melhorias: RetroImprovement[]): Promise<void> {
  const say = (key: string, params: Record<string, string>): void => {
    const spoken = t(key, params);
    retro.talk.push({ me: false, text: spoken, speech: spoken, at: now() });
  };
  for (const [i, m] of melhorias.entries()) {
    const body = [
      t('main.retro.issue.dimension', { value: m.dimensao }),
      '',
      t('main.retro.issue.problem', { value: m.problema }),
      '',
      t('main.retro.issue.proposal', { value: m.proposta }),
      '',
      t('main.retro.issue.origin', { date: formatDate(new Date(retro.to)), id: retro.id }),
    ].join('\n');
    const plan = await planned(m, body);
    if ('reason' in plan) {
      say('main.retro.issue.refused', { title: m.titulo, reason: plan.reason });
      continue;
    }
    const key = `retro-issue:${retro.id}:${slug(m.titulo) || `i${i}`}`;
    const summary = t('main.retro.issue.summary', { title: m.titulo });
    const made = proposeVcsAction({
      key,
      // The issue does not exist yet; the card of a retro proposal reads neither the number nor the title of an issue.
      issue: 0,
      issueTitle: '',
      stage: '',
      summary,
      detail: body,
      command: plan.commands[0],
      unit: { purpose: 'retro-issue', retro: retro.id, key },
      notify: { title: summary, body: t('main.retro.issue.proposed', { title: m.titulo }) },
    });
    // Null: a proposal with this key already waits, runs or was done. Saying it again would repeat a note the person already has.
    if (made) say('main.retro.issue.proposed', { title: m.titulo });
  }
}

/** Adds a note to a stored retro's conversation; a retro that is not there any more is not an error. */
export function noteRetroIssue(retroId: string, key: string, params: Record<string, string>): void {
  const retro = readRetro(retroId);
  if (!retro) return;
  const spoken = t(key, params);
  retro.talk.push({ me: false, text: spoken, speech: spoken, at: now() });
  writeRetro(retro);
}
