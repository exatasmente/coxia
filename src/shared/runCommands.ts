import type { ForumMessage } from './forum';

// The list of the commands each agent ran, built from what the run already records: the `runner.exec` and `runner.exec.host` messages of its thread, which carry
// the agent, the stage, the number, the command, where it ran, how it ended and how long it took. Pure: it takes the messages and groups them, so the run's screen
// and the message the run posts at its end read the same list, and neither posts anything to the code host.

/** Where a command ran: in the sandbox of the stage, or on the person's own computer (`shell: host`). */
export type RunCommandVia = 'sandbox' | 'host';

export interface RunCommand {
  agent: string;
  stage: string;
  /** 1-based, in the order it ran in the stage. */
  n: number;
  command: string;
  via: RunCommandVia;
  /** How it ended, already in the app's words (the exit code, the timeout, the refusal, "did not run to an exit"). */
  result: string;
  /** How long it took, in seconds. */
  ms: number;
}

export interface RunStageCommands {
  stage: string;
  commands: RunCommand[];
}

export interface RunAgentCommands {
  agent: string;
  stages: RunStageCommands[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : 0);

/** One command from a message, or null when the message is not a command of a run. */
function commandOf(m: ForumMessage): RunCommand | null {
  if (m.code !== 'runner.exec' && m.code !== 'runner.exec.host') return null;
  const p = m.params;
  return {
    agent: typeof p.agent === 'string' ? p.agent : m.author.type === 'agent' ? m.author.id : 'app',
    stage: m.stage ?? '',
    n: num(p.n),
    command: typeof p.command === 'string' ? p.command : '',
    via: m.code === 'runner.exec.host' ? 'host' : 'sandbox',
    result: typeof p.result === 'string' ? p.result : '',
    ms: num(p.ms),
  };
}

/** The commands of a thread, by agent and, inside the agent, by stage, in the order they ran. */
export function groupCommands(messages: ForumMessage[]): RunAgentCommands[] {
  const byAgent = new Map<string, Map<string, RunCommand[]>>();
  for (const m of messages) {
    const c = commandOf(m);
    if (!c) continue;
    const stages = byAgent.get(c.agent) ?? new Map<string, RunCommand[]>();
    const list = stages.get(c.stage) ?? [];
    list.push(c);
    stages.set(c.stage, list);
    byAgent.set(c.agent, stages);
  }
  return [...byAgent.entries()].map(([agent, stages]) => ({
    agent,
    stages: [...stages.entries()].map(([stage, commands]) => ({ stage, commands: commands.slice().sort((a, b) => a.n - b.n) })),
  }));
}

/** How many commands a grouped list holds. */
export const countCommands = (groups: RunAgentCommands[]): number => groups.reduce((n, g) => n + g.stages.reduce((k, s) => k + s.commands.length, 0), 0);
