// Whether a workspace lifted the fence of its runs: the file tools of a run's agents read and, when the agent writes, write anywhere on the machine instead of only
// in the run's worktree. Only the computer turns it on; a config stored before it existed, or without it, keeps the fence.

export const unconfinedOf = (runner: { unconfined?: boolean } | null | undefined): boolean => runner?.unconfined === true;
