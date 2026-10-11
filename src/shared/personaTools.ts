// The names of the persona's eleven tools (#248), in the one place both the main process (the table of its door) and the window (the words of the line an act leaves in the chat)
// read. Data only.

export const PERSONA_TOOLS = ['Overview', 'Runs', 'Actions', 'Board', 'Conversations', 'Memory', 'Settings', 'Secrets', 'Plugins', 'Asks', 'Ceremonies'] as const;
export type PersonaToolName = (typeof PERSONA_TOOLS)[number];
