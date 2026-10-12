// Whether a workspace lets a stage hand its task to a Claude Code session. Only the computer turns it on; a config stored before it existed, or without it, keeps it off.

export const claudeCodeTasksOf = (runner: { claudeCodeTasks?: boolean } | null | undefined): boolean => runner?.claudeCodeTasks === true;
