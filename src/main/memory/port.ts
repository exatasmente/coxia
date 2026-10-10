import type { AuditEntry } from '../../shared/auditoria';
import type { AgentDef, WorkspaceConfig } from '../../shared/config/types';
import { memoryOn, type MemorySurface } from '../../shared/memory';
import type { MemoryIndex } from './index';
import { createMemorySession, type MemorySession, type MemorySessionContext } from './session';
import type { MemoryStore } from './store';

// The door a call goes through to get its memory. A stage, a mention, an agent called by another, the answer of a question chain or a request and a ceremony each ask `open`
// for a session; the answer is null when the workspace's switch is off, which is how "off" means no tool, no prompt section, no folder and no write by any agent. The person's
// own view of the memory (the channels) does not come through here and works whatever the switch says.

export interface MemoryOpenContext {
  surface: MemorySurface;
  /** The agent the call runs as. */
  agent: Pick<AgentDef, 'id' | 'permission' | 'model'>;
  /** The thread the call works in; null for a chain, a request and a ceremony. */
  conversation: string | null;
  /** False: chain, request, ceremony. Only a writing session makes a folder. */
  writes: boolean;
  /** False: the `teams` role, which has no tools at all. */
  tools: boolean;
  /** The activity, repository and run the call is about (relevance), and the call's own run, whose documents are not listed back to it. */
  ref?: string | null;
  repo?: string;
  runId?: string | null;
  issue?: number;
  /** What the message named, as the activities cut already takes it. */
  named?: { refs: string[]; agents: string[] };
  screen?: MemorySessionContext['screen'];
  mask?: MemorySessionContext['mask'];
  note?: MemorySessionContext['note'];
  /** A ceremony on a voice path never waits for git. */
  cacheOnly?: boolean;
}

export interface MemoryPort {
  /** A session, or null when the switch is off or the memory could not be opened (the call goes on without it). */
  open(ctx: MemoryOpenContext): Promise<MemorySession | null>;
}

export interface MemoryPortDeps {
  config(): WorkspaceConfig;
  store: MemoryStore;
  index: MemoryIndex;
  audit?(entry: Omit<AuditEntry, 'at'>): void;
  /** Where a failure of the memory is reported (the error log); the source is `memory` and the error carries no path. */
  onError?(source: string, error: Error): void;
  log?(line: string): void;
  home?: string;
}

export function createMemoryPort(deps: MemoryPortDeps): MemoryPort {
  let said = false;
  return {
    // A call goes on without memory when it cannot be opened: a stage or an answer is never failed by it.
    async open(ctx) {
      if (!memoryOn(deps.config())) return null;
      try {
        return await createMemorySession(
          { store: deps.store, index: deps.index, audit: deps.audit, log: deps.log },
          {
            surface: ctx.surface,
            agent: ctx.agent.id,
            conversation: ctx.conversation,
            writes: ctx.writes,
            tools: ctx.tools,
            ...(ctx.ref !== undefined ? { ref: ctx.ref } : {}),
            ...(ctx.repo ? { repo: ctx.repo } : {}),
            ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
            ...(ctx.issue !== undefined ? { issue: ctx.issue } : {}),
            ...(ctx.named ? { named: ctx.named } : {}),
            ...(ctx.screen ? { screen: ctx.screen } : {}),
            ...(ctx.mask ? { mask: ctx.mask } : {}),
            ...(ctx.note ? { note: ctx.note } : {}),
            ...(ctx.cacheOnly ? { cacheOnly: true } : {}),
            ...(deps.home ? { home: deps.home } : {}),
          },
        );
      } catch (e) {
        if (!said) {
          said = true;
          try {
            deps.onError?.('memory', new Error(`the memory could not be opened (${e instanceof Error ? e.name : 'error'})`));
          } catch {
            // The log failing is not the call's to know.
          }
        }
        return null;
      }
    },
  };
}
