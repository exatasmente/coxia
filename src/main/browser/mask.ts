// The one place a mask is applied to what the page shows the agent. Page text is not redacted or filtered (the agent gets what the page shows, inside a data fence and cut to a
// cap); a mask is for a value the person typed during a hand-off, which the agent must never read back. #177 builds the place and adds no mask; the hand-off (#178) adds its own.

export type Mask = (text: string) => string;

export interface MaskSet {
  /** Adds a mask; returns the way to take it off. Masks run in the order they were added. */
  add(mask: Mask): () => void;
  /**
   * The text with every mask applied. A mask that throws withholds the whole text (null): what could not be checked is not sent. Never throws.
   */
  apply(text: string): string | null;
  readonly size: number;
}

export function createMaskSet(): MaskSet {
  const masks = new Set<Mask>();
  return {
    add(mask) {
      masks.add(mask);
      return () => void masks.delete(mask);
    },
    apply(text) {
      let out = text;
      for (const mask of [...masks]) {
        try {
          out = mask(out);
        } catch {
          return null;
        }
      }
      return out;
    },
    get size() {
      return masks.size;
    },
  };
}
