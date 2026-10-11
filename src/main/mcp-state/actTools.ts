import { TOOL_NAMES } from '../persona/doorTable';
import { doorText } from '../persona/doorText';
import { describeTool, schemaOf } from '../persona/tools';
import { createBridgeClient, type BridgeClient } from './bridge';
import { resolveWorkspace, type StateTool } from './tools';

// The persona's tools as the state server lists them when the workspace's second switch is on (`mcpState.act`): the same names, descriptions and schemas the persona's model
// reads, so a terminal session asks for exactly what the door takes. Nothing runs here: each call goes to the open app (bridge.ts), which runs it through the persona's door.
// The switch is read when the list is made and again at every call, so turning it off stops a session that already listed them.

/** The tools, or none when the workspace is not served or the switch is off. */
export function actTools(env: NodeJS.ProcessEnv, client?: (dir: string) => BridgeClient): StateTool[] {
  const served = resolveWorkspace(env);
  if (!served.ok || !served.act) return [];
  const clients = new Map<string, BridgeClient>();
  const clientOf = (dir: string): BridgeClient => {
    let c = clients.get(dir);
    if (!c) clients.set(dir, (c = (client ?? createBridgeClient)(dir)));
    return c;
  };
  return TOOL_NAMES.map((name) => ({
    name,
    description: describeTool(name),
    inputSchema: schemaOf(name) as unknown as Record<string, unknown>,
    async run(args) {
      const now = resolveWorkspace(env);
      if (!now.ok) return { text: now.text, isError: true };
      if (!now.act) return { text: doorText('terminal.off'), isError: true };
      const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
      const answer = await clientOf(now.dir).call(name, input);
      if ('failure' in answer) return { text: doorText(`terminal.${answer.failure}`), isError: true };
      return { text: answer.text, isError: answer.isError };
    },
  }));
}
