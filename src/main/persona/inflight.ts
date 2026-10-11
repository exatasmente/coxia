// The acts of the persona that are running now, between the moment a handler starts and the moment it settles: what the line of a stop names as still going. The door
// registers each act here (a short, masked description); nothing else reads or writes it.

let next = 0;
const acts = new Map<number, string>();

/** An act began; the returned function says it settled. */
export function beginInflight(label: string): () => void {
  const id = (next += 1);
  acts.set(id, label);
  return () => void acts.delete(id);
}

/** The acts running now, oldest first. */
export const inflightLabels = (): string[] => [...acts.values()];
