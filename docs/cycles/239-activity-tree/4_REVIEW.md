# Review of the activity tree

Reviewed in a session separate from the one that wrote the code, against the approved spec and plan, the repository's rules and the earlier activity rule it changes on purpose. Base: `release/0.9.0` at `0.9.0-beta.16`.

## Verdict

Merge. No blocker and no major.

## Gates at review time

`npx tsc --noEmit`, `npx vitest run` (461 files, 7,755 tests), `node scripts/theme-audit.mjs`, `npm run i18n:lint` (5,743 keys in both languages) and `node scripts/public-audit.mjs`: all green.

## What was checked

**Masking and the switch**
- Reasoning and answer excerpts are masked in the main process before they enter the log or the stream, within their caps.
- With the switch off, no thought is created, in both engines, in sub-agents and in ceremonies.

**What never enters the activity**
- No tool result, file content or engine answer enters it, and the leak tests keep their meaning.

**Configuration and phone**
- The switch is editable from a paired browser on purpose.
- The migration raises no permission.

**Tree shape**
- The three call paths end in the same tree.
- Refused calls make no node.
- Parallel sub-agents get one node each.
- A child never evicts its parent, live trees are never trimmed, and backfill returns whole live trees.
- The badge counts top-level entries.
- Parentless activity becomes its own entry.

## Findings

Fixed before merge (see `3_IMPLEMENTATION.md`):

1. The log's thought gate defaulted to on until the workspace switch was wired. It now defaults to off.
2. Every incoming line rebuilt the tree of every bucket. The tree is now memoized per bucket.
3. A sub-agent node could stay "started" if caller code threw between the node's creation and the guarded block. It now always ends.
4. A called agent that gave no answer ended "failed" on one path (a call inside an answer) and "finished" on the other (a call from a stage). Both now end "failed".
5. Screen-reader text on the collapsible rows contradicted `aria-expanded`.

Left as is:
- Thoughts already in memory stay in a backfill after the switch is turned off, until they age out. The spec says so.
- `underNode` prefers the ambient node; it is safe because a child's job and call are re-derived from its parent.
- The scan bound of the mask runs before whitespace is flattened. Abusing it needs a contrived input.
- Old opacity-based muted text; the migration note in English, as the other notes are.

## Not verified

- **Nothing was seen on screen**, and no test renders a component.
- **The Claude SDK:** sub-agent path (forwarded lines, `parent_tool_use_id` of parallel sub-agents), whether its models return thinking text by default, and a call made from inside an SDK sub-agent, which hangs under the main agent.
- **The paired phone end to end.**
