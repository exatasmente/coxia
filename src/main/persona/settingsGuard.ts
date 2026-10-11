import { t } from '../../shared/i18n';
import type { WorkspaceConfig } from '../../shared/config/types';
import { personaOf } from '../../shared/config/team';
import { same } from '../configScope';

// What the persona's `Settings.set` may not reach, though it reaches the rest of the configuration (#248). Each of the three is a channel the door excludes, and the same change made
// through a path of the whole document would walk round that exclusion:
//  - the test-only mark of a test-environment secret: the person's confirmation of a secret that is not test-only is theirs, and a persona that marks one test-only needs none;
//  - `mcpState`, which the door excludes as the machine's (the MCP servers the computer runs);
//  - the persona's own entry in the team: its identity and its instructions belong to the editor (`persona:save`, `clear`, `delete`), which is excluded. Its reach (`permission`,
//    `shell`, `tracker`, `screen`, hosts...) is not: the spec lets it change those and marks the change `raised`.
// Pure: the refusal is worded here, and the door records it as a refused act.

/** The reason the next configuration is refused, or null. */
export function personaSettingsRefusal(before: WorkspaceConfig, after: WorkspaceConfig): string | null {
  const wasTestOnly = new Set((before.testEnvironment?.secrets ?? []).filter((s) => s.testOnly).map((s) => s.ref));
  const marked = (after.testEnvironment?.secrets ?? []).find((s) => s.testOnly && !wasTestOnly.has(s.ref));
  if (marked) return t('main.persona.door.guard.testOnly', { ref: marked.ref });

  if (!same(before.mcpState, after.mcpState)) return t('main.persona.door.guard.mcpState');

  const own = personaOf(before.agents.team);
  if (own) {
    const next = after.agents.team.find((a) => a.id === own.id);
    if (!next) return t('main.persona.door.guard.ownEntry');
    if (next.kind !== own.kind || next.instructions !== own.instructions || next.name !== own.name) return t('main.persona.door.guard.ownEdit');
  }
  return null;
}
