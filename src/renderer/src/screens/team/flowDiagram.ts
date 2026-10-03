import type { AgentDef, StageDef } from '../../../../shared/config/types';
import { flowOf } from '../../../../shared/runs/flow';
import { shown } from './text';

// The flow as a mermaid flowchart: forward arrows solid, returns dashed, a gate drawn as a hexagon and a wait as a rounded pill. Only shapes and line
// styles tell them apart (no colors, so the theme stays the diagram's own).

export interface DiagramWords {
  /** The label of a return arrow. */
  returns: string;
}

const clean = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/[<>"`]/g, '').replace(/#/g, '#35;').trim();

// A stage sends the work back when it is a gate, a review or a QA pass, or when it says where to.
const sendsBack = (s: StageDef): boolean => s.type === 'gate' || s.returnsTo !== undefined || ((s.type ?? 'work') === 'work' && (s.kind === 'review' || s.kind === 'qa'));

export function flowDiagram(stages: StageDef[], team: AgentDef[], agentLabel: (a: AgentDef) => string, words: DiagramWords): string {
  const flow = flowOf({ agents: { team }, devCycle: { stages } }, stages);
  const index = new Map(flow.map((s, i) => [s.id, i]));
  const lines = ['flowchart TD']; // i18n-ignore: mermaid syntax
  flow.forEach((s, i) => {
    const agent = s.agent ? team.find((a) => a.id === s.agent) : undefined;
    const text = clean(shown(s.label || s.id)) + (agent ? `<br/>${clean(agentLabel(agent))}` : '');
    const node = s.type === 'gate' ? `n${i}{{"${text}"}}` : s.type === 'wait' ? `n${i}(["${text}"])` : `n${i}["${text}"]`;
    lines.push(`  ${node}`);
  });
  flow.forEach((s, i) => {
    const to = s.next === null ? undefined : index.get(s.next);
    if (to !== undefined) lines.push(`  n${i} --> n${to}`);
    const back = s.returnsTo ? index.get(s.returnsTo) : undefined;
    if (back !== undefined && sendsBack(stages[i])) lines.push(`  n${i} -.->|"${clean(words.returns)}"| n${back}`);
  });
  return lines.join('\n');
}
