import type { AuditEntry } from '../../shared/auditoria';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { proceduresOn, type ProcedureSurface } from '../../shared/procedures';
import type { ProcedureScreen } from './screen';
import { createProcedureSession, type ProcedureSession, type SessionDeps } from './session';
import { createProcedureStore, type ProcedureStore } from './store';

// The door a call goes through to get its procedures. A stage, a conversation answer and an agent a stage called each ask `open` for a session; the answer is null when the
// workspace's switch is off, which is how "off" means no tool, no prompt section and no write by any agent. A ceremony and a call with no session of work never ask.

export interface OpenContext {
  surface: ProcedureSurface;
  /** The agent that works the call, as it runs in it (a mention runs as a reader). */
  agent: Pick<AgentDef, 'id' | 'permission' | 'shell' | 'allowedCommands' | 'allowedHosts' | 'model'>;
  /** The run reference or the thread id: what a record says it was written from and a use is filed under. */
  ref: string;
  /** The run's issue number, for the audit; absent outside a run. */
  issue?: number;
  /** The kind of the stage, when the surface is a stage. */
  stage?: string;
  /** The ids of the repositories the call works in. */
  repos: readonly string[];
  /** A conversation lists the `request` records; a stage does not. */
  requests?: boolean;
  /** The repositories (ids) whose checkout carries an AGENTS.md. */
  agentsMd?: ReadonlySet<string>;
  /** A system line in the place the call works in (the thread of the run or the conversation). */
  note?: SessionDeps['note'];
  /** The call's screen, through the adapter: its steps for a draft, and the hand-off's seams. Absent: the call has none. */
  screen?: ProcedureScreen;
}

export interface ProceduresPort {
  open(ctx: OpenContext): ProcedureSession | null;
}

export interface PortDeps {
  config(): WorkspaceConfig;
  /** The workspace's own folder: the records are in `<it>/memory/procedures/`. */
  dir: string;
  /** Names of the plugins that are on, for the `tool` records. */
  pluginNames?(): string[];
  audit?(entry: Omit<AuditEntry, 'at'>): void;
  /** The context window of the agent's model in tokens, when known: a small one shrinks the list. */
  contextWindow?(model: AgentDef['model']): number | null;
  now?(): number;
  /** The store, when the caller made one (a test); the port makes its own over `dir` otherwise. */
  store?: ProcedureStore;
}

/** A name as the key of a `tool` record spells it: a lowercase slug. */
export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** The first word of each allowed command (`npm test` is npm, `git:*` is git): the command-line tools the agent has. */
export function commandTools(commands: readonly string[] | undefined): string[] {
  return [...new Set((commands ?? []).map((c) => /^[\w.-]+/.exec(c.trim())?.[0]?.toLowerCase() ?? '').filter(Boolean))];
}

export function createProceduresPort(deps: PortDeps): ProceduresPort {
  const store = deps.store ?? createProcedureStore(deps.dir);
  return {
    open(ctx) {
      const config = deps.config();
      if (!proceduresOn(config)) return null;
      const agent = ctx.agent;
      const tools = [...new Set([...(deps.pluginNames?.() ?? []).map(slug), ...config.vcs.map((v) => v.kind), ...commandTools(agent.allowedCommands)].filter(Boolean))];
      return createProcedureSession(
        { store, now: deps.now, note: ctx.note, audit: deps.audit },
        {
          writer: { by: agent.id, surface: ctx.surface, ...(ctx.stage ? { stage: ctx.stage } : {}), ref: ctx.ref, permission: agent.permission, ...(agent.shell ? { shell: agent.shell } : {}) },
          issue: ctx.issue,
          ...(ctx.screen ? { screen: ctx.screen } : {}),
          workspaceRepos: config.projects.repos.map((r) => r.id),
          select: {
            repos: ctx.repos,
            ...(ctx.stage ? { stageKind: ctx.stage } : {}),
            tools,
            hosts: [...new Set((agent.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean))],
            ...(ctx.requests ? { requests: true } : {}),
            ...(ctx.agentsMd ? { agentsMd: ctx.agentsMd } : {}),
            language: config.language,
            contextWindow: deps.contextWindow?.(agent.model) ?? null,
          },
        },
      );
    },
  };
}
