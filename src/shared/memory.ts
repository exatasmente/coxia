// The shared, indexed memory of the agents (docs/cycles/215-shared-indexed-memory). Shared by the main process and the renderer.

/** The switch of the shared memory: absent (a config stored before it) reads as off. Off offers no tool, no prompt section, no folder and no notice, and the view still works. */
export const memoryOn = (config: { runner?: { sharedMemory?: boolean } | null } | null | undefined): boolean => config?.runner?.sharedMemory === true;
