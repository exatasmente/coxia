// The named happenings a plugin may observe. Fixed and public: the kit publishes this list and the app refuses
// any declaration that names one outside it. It is not the interface channel between the window and the paired
// browser (AppEvent, shared/types.ts): a separate extension point with its own names.

export const PLUGIN_EVENTS = ['stage-entered', 'stage-finished', 'gate-decided', 'run-finished'] as const;
export type PluginEvent = (typeof PLUGIN_EVENTS)[number];

/** Whether an event a declaration named is one the app publishes. */
export function isPluginEvent(name: string): name is PluginEvent {
  return (PLUGIN_EVENTS as readonly string[]).includes(name);
}
