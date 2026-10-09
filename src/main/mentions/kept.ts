import { rmSync } from 'node:fs';
import type { CallHandoff } from '../screen/handoff';
import type { SandboxSession } from '../sandbox';

// The shell session of an agent that has a screen, kept between its answers in a conversation (rule 13 of #177): the first answer makes the throwaway copy of the code and the
// session (with a display, which the app's browser draws on), the next ones find them as they were, and they end together with the screen, whatever ends it. The registry knows
// nothing of screens: the screen sessions call `release` when they close (the `onClose` of the request that opened the screen), and an answer that finds no kept session makes one.
//
// What a session holds that belongs to one answer (the signal that stops a copy, the clock a host command's question stops) is read through a cell the session keeps, so an answer that uses the
// kept session says what its own are, and the answer after it says its own.

/** What belongs to the answer that is using the session now. */
export interface Binding {
  signal: AbortSignal;
  /** Stops the answer's clocks while a command waits for the person; returns the way to start them. */
  pause: () => () => void;
  /** The answer shows a sign of life. */
  beat: () => void;
  /** The answer's hand-off of the screen (#178): a kept session refuses commands and masks output through whichever answer has it now. */
  handoff?: CallHandoff | null;
}

/** Where the answer using a session says what is its own; read by the session when it needs it, so it follows the answer that has the session now. */
export interface BindingCell {
  bound: Binding | null;
}

/** Where an agent's commands run: the folder, whether the app made it (and removes it), and whether it is read only. */
export interface ShellSource {
  cwd: string;
  made: boolean;
  reader: boolean;
  clone?: string;
}

export interface KeptShell {
  session: SandboxSession;
  source: ShellSource;
  /** The session's display, when it has one: what the app's browser is lent. */
  display: { socket: string; kind: 'sandbox' | 'host' } | null;
  /** What the session reads of the answer using it; set at the start of an answer and cleared at its end. */
  cell: BindingCell;
  /** Aborted when the session ends: what the session was opened with, since no single answer owns it. */
  life: AbortController;
}

export interface KeptSessions {
  /** The session kept for the screen, or null. */
  get(key: string): KeptShell | null;
  /** Keeps a session for the screen. A session already kept for the key is closed first: one per screen. */
  keep(key: string, shell: KeptShell): Promise<void>;
  /** Ends the session kept for the screen and removes its copy. Never throws; false when there was none. */
  release(key: string): Promise<boolean>;
  /** The keys of the sessions kept. */
  keys(): string[];
}

export function createKeptSessions(): KeptSessions {
  const kept = new Map<string, KeptShell>();
  const end = async (shell: KeptShell): Promise<void> => {
    shell.cell.bound = null;
    shell.life.abort();
    await shell.session.close().catch(() => undefined);
    // A copy the app made is the app's to remove, once nothing runs in it; a run's own worktree is not.
    if (shell.source.made) rmSync(shell.source.cwd, { recursive: true, force: true });
  };
  return {
    get: (key) => kept.get(key) ?? null,
    async keep(key, shell) {
      const old = kept.get(key);
      kept.set(key, shell);
      if (old && old !== shell) await end(old);
    },
    async release(key) {
      const shell = kept.get(key);
      if (!shell) return false;
      kept.delete(key);
      await end(shell);
      return true;
    },
    keys: () => [...kept.keys()],
  };
}

/** The sessions kept by this process. */
export const keptSessions: KeptSessions = createKeptSessions();
