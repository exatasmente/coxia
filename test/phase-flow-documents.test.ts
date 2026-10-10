import { describe, expect, it } from 'vitest';
import type { PhaseFile } from '../src/shared/config/types';
import type { PluginDocumentType } from '../src/shared/plugins/declaration';
import { withPhaseDocuments } from '../src/shared/plugins/phase';

// The phase list of a cycle with the plugin documents that say where they stand in it. The list the cycle ships keeps its order, its positions and
// its labels; only the anchored documents move, and none of them moves a list whose anchor is not there.

const core = (): PhaseFile[] => [
  { file: '3_IMPLEMENTATION.md', label: 'cycle.agentFlow.phase.implementation' },
  { file: '2_PLAN.md', label: 'cycle.agentFlow.phase.plan' },
  { file: '1_SPEC.md', label: 'cycle.agentFlow.phase.spec' },
];

const doc = (name: string, before: string, label?: string): PluginDocumentType => ({
  name,
  label: `${name} label`,
  flow: { gate: 1, phase: { ...(label ? { label } : {}), before } },
});

describe('the phase of a cycle joined with the plugin documents', () => {
  it('is the list of the cycle itself when no document declares its place', () => {
    const list = core();
    const out = withPhaseDocuments(list, [{ name: '7_WEB_SEARCH.md', label: 'Web search' }]);
    expect(out).toEqual(list);
    // A fresh list handed to the reader, never the one the cycle holds.
    expect(out).not.toBe(list);
  });

  it('puts a document just above its anchor, more advanced than the anchored file', () => {
    const out = withPhaseDocuments(core(), [doc('REQUIREMENTS.md', '1_SPEC.md')]);
    expect(out.map((p) => p.file)).toEqual(['3_IMPLEMENTATION.md', '2_PLAN.md', 'REQUIREMENTS.md', '1_SPEC.md']);
  });

  it('orders every document of the flow at its own anchor', () => {
    const out = withPhaseDocuments(core(), [doc('REQUIREMENTS.md', '1_SPEC.md'), doc('PROTOTYPE.md', '2_PLAN.md'), doc('USER_MANUAL.md', '3_IMPLEMENTATION.md')]);
    expect(out.map((p) => p.file)).toEqual(['USER_MANUAL.md', '3_IMPLEMENTATION.md', 'PROTOTYPE.md', '2_PLAN.md', 'REQUIREMENTS.md', '1_SPEC.md']);
  });

  it('keeps the declaration order when two documents anchor to the same file', () => {
    const out = withPhaseDocuments(core(), [doc('A.md', '2_PLAN.md'), doc('B.md', '2_PLAN.md')]);
    expect(out.map((p) => p.file)).toEqual(['3_IMPLEMENTATION.md', 'A.md', 'B.md', '2_PLAN.md', '1_SPEC.md']);
  });

  it('leaves a document whose anchor the list does not have out of the phase: a flow edited by the person keeps the phase it has', () => {
    expect(withPhaseDocuments(core(), [doc('REQUIREMENTS.md', 'GONE.md')]).map((p) => p.file)).toEqual(['3_IMPLEMENTATION.md', '2_PLAN.md', '1_SPEC.md']);
  });

  it('never counts a document without a phase anchor: a stage by-product stays out of the phase', () => {
    expect(withPhaseDocuments(core(), [{ name: '7_WEB_SEARCH.md', label: 'Web search', flow: { gate: 2 } }, { name: '8.md', label: 'Eight' }]).map((p) => p.file)).toEqual(['3_IMPLEMENTATION.md', '2_PLAN.md', '1_SPEC.md']);
  });

  it('takes the phase label the document declares, and its own label when it declares none', () => {
    const out = withPhaseDocuments(core(), [doc('REQUIREMENTS.md', '1_SPEC.md', 'cycle.agentFlow.phase.requirements'), doc('PROTOTYPE.md', '2_PLAN.md')]);
    expect(out.find((p) => p.file === 'REQUIREMENTS.md')?.label).toBe('cycle.agentFlow.phase.requirements');
    expect(out.find((p) => p.file === 'PROTOTYPE.md')?.label).toBe('PROTOTYPE.md label');
  });

  it('keeps every entry of the cycle list untouched, label included', () => {
    const out = withPhaseDocuments(core(), [doc('REQUIREMENTS.md', '1_SPEC.md')]);
    for (const entry of core()) expect(out).toContainEqual(entry);
  });
});