import type { PhaseFile } from '../config/types';
import type { PluginDocumentType } from './declaration';

/**
 * The phase list of a cycle with the plugin documents that declare their place in it. A document enters just above the file it is anchored to (`before`,
 * more advanced than it), keeping the order of the declaration when two anchor to the same file; an anchor the list does not have means the document does
 * not enter at all, so a flow edited by the person keeps exactly the phase it has today. Documents without a phase anchor (a stage's by-products) never
 * enter. The list handed in is not changed: the phase is read with the plugin's documents of the moment and goes away with them when the plugin is off.
 */
export function withPhaseDocuments(core: PhaseFile[], documents: PluginDocumentType[]): PhaseFile[] {
  const anchored = documents.filter((d): d is PluginDocumentType & { flow: { phase: { label?: string; before: string } } } => !!d.flow?.phase);
  if (!anchored.length) return [...core];
  return core.flatMap((entry) => [
    ...anchored
      .filter((d) => d.flow.phase.before === entry.file)
      .map((d): PhaseFile => ({ file: d.name, label: d.flow.phase.label ?? d.label })),
    entry,
  ]);
}