import type { Coxia } from './core';
import { exitProcess } from './host';

// What a headless host does with the signals a service manager sends: stop the core, then leave. The desktop does not install this, Electron quits by its own path.

export interface SignalHandlers {
  /** What a signal does; exposed so a test can deliver one without signalling its own process. */
  deliver(signal: NodeJS.Signals): Promise<void>;
  /** Takes the listeners off the process. */
  dispose(): void;
}

export interface SignalOptions {
  signals?: NodeJS.Signals[];
  deadlineMs?: number;
  /** Ends the process with this code; the host's exit when absent. */
  exit?: (code: number) => void;
}

/** SIGTERM and SIGINT stop the core and then exit 0 (1 when the stop failed). A second signal while it stops exits at once: the person asked twice. */
export function installSignalHandlers(core: Pick<Coxia, 'stop'>, options: SignalOptions = {}): SignalHandlers {
  const exit = options.exit ?? exitProcess;
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  let stopping = false;
  const deliver = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) {
      console.error(`[core] ${signal} again, leaving without waiting`);
      exit(1);
      return;
    }
    stopping = true;
    console.log(`[core] ${signal}, stopping`);
    try {
      await core.stop(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs });
      exit(0);
    } catch (e) {
      console.error('[core] stop failed', e instanceof Error ? e.message : e);
      exit(1);
    }
  };
  const listeners = signals.map((signal) => {
    const listener = (): void => void deliver(signal);
    process.on(signal, listener);
    return [signal, listener] as const;
  });
  return {
    deliver,
    dispose: () => {
      for (const [signal, listener] of listeners) process.off(signal, listener);
    },
  };
}
