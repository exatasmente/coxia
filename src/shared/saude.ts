export interface TaskHealth {
  name: string;
  label: string;
  everyMin: number | null;
  lastRunAt: string | null;
  durationMs: number | null;
  // null until the first run.
  ok: boolean | null;
  message: string;
  failStreak: number;
}

export type DepId = 'vcs' | 'llm-key' | 'card-source' | 'voice' | 'model';

export interface DepHealth {
  id: DepId;
  label: string;
  // null: not checked yet.
  ok: boolean | null;
  message: string;
  checkedAt: string | null;
  durationMs: number | null;
}

export interface SaudeSnapshot {
  tasks: TaskHealth[];
  deps: DepHealth[];
  // Tasks whose last run failed plus dependencies that failed their last check.
  problems: number;
  checking: boolean;
}
