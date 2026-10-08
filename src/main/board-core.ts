import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BOARD_VERSION, type BoardCard, type BoardFile, type BoardHostLink, type BoardHostNote, type BoardPatch, type HostSeen, type MirrorContext, applyMirror, applyPatch, emptyBoard, mirrorOf } from '../shared/board';

// The board file of a workspace: one JSON document, written atomically like the actions and the status files. Electron-free and pure over its
// path, so the whole rule of the board is tested without the app: the store never decides what a card may carry (the module does), it only reads,
// writes and changes one card at a time.

export interface BoardStoreDeps {
  /** The board file. */
  file: string;
  now(): Date;
}

export interface BoardStore {
  list(): BoardCard[];
  get(id: string): BoardCard | null;
  /** `id` comes from the caller (the module makes it from random bytes); a test passes its own. */
  create(input: { id: string; title: string; body: string; column: string; squad: string | null; priority: string | null; labels: string[]; repo: string | null }): BoardCard;
  /** Changes one card; throws when the id is not there. */
  update(id: string, patch: BoardPatch): BoardCard;
  close(id: string): BoardCard;
  reopen(id: string): BoardCard;
  comment(id: string, text: string): BoardCard;
  /** The card became this issue: records the link, clears the note and adds a `sent` line. The same link again changes nothing. */
  link(id: string, link: BoardHostLink): BoardCard;
  /** Why the last attempt to reach the host left no link; null clears it. The same note again changes nothing. */
  note(id: string, note: Omit<BoardHostNote, 'at'> | null): BoardCard;
  /** Takes what the host said into the card's copy, with a `host` line for each change; the file is written only when something changed. */
  mirror(id: string, seen: HostSeen, ctx: MirrorContext): BoardCard;
}

const sameLink = (a: BoardHostLink | undefined, b: BoardHostLink): boolean => !!a && a.vcs === b.vcs && a.project === b.project && a.iid === b.iid && a.url === b.url;

/** A link read from the file is kept only whole: a damaged one is dropped, so the card reads as one that is only on the board. */
function sane(card: BoardCard): BoardCard {
  const h = card.host as Partial<BoardHostLink> | undefined;
  if (h === undefined || (h && typeof h === 'object' && typeof h.project === 'string' && Number.isInteger(h.iid) && typeof h.url === 'string' && typeof h.vcs === 'string')) return card;
  const { host: _host, ...rest } = card;
  return rest;
}

function readFile(file: string): BoardFile {
  try {
    if (!existsSync(file)) return emptyBoard();
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BoardFile>;
    if (parsed.version !== BOARD_VERSION || !Array.isArray(parsed.cards)) return emptyBoard();
    return { version: BOARD_VERSION, cards: parsed.cards.filter((c): c is BoardCard => !!c && typeof c === 'object' && typeof (c as BoardCard).id === 'string').map(sane) };
  } catch {
    // A file that cannot be read is not a board: nothing is invented and nothing is overwritten until the next write.
    return emptyBoard();
  }
}

function writeFile(file: string, board: BoardFile): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(board, null, 1));
  renameSync(`${file}.tmp`, file);
}

export function createBoardStore(d: BoardStoreDeps): BoardStore {
  const at = (): string => d.now().toISOString();

  const writeCard = (id: string, change: (card: BoardCard, stamp: string) => BoardCard): BoardCard => {
    const board = readFile(d.file);
    const i = board.cards.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`board card not found: ${id}`);
    const next = change(board.cards[i], at());
    if (next === board.cards[i]) return next;
    board.cards[i] = next;
    writeFile(d.file, board);
    return next;
  };

  return {
    list: () => readFile(d.file).cards,
    get(id) {
      return readFile(d.file).cards.find((c) => c.id === id) ?? null;
    },
    create(input) {
      const board = readFile(d.file);
      const stamp = at();
      const card: BoardCard = {
        id: input.id,
        title: input.title,
        body: input.body,
        column: input.column,
        squad: input.squad,
        priority: input.priority,
        labels: input.labels,
        repo: input.repo,
        state: 'open',
        createdAt: stamp,
        updatedAt: stamp,
        history: [{ at: stamp, kind: 'created' }],
      };
      board.cards.push(card);
      writeFile(d.file, board);
      return card;
    },
    update: (id, patch) => writeCard(id, (card, stamp) => applyPatch(card, patch, stamp)),
    close: (id) => writeCard(id, (card, stamp) => applyPatch(card, { state: 'closed' }, stamp)),
    reopen: (id) => writeCard(id, (card, stamp) => applyPatch(card, { state: 'open' }, stamp)),
    comment: (id, text) => writeCard(id, (card, stamp) => applyPatch(card, { comment: text }, stamp)),
    link: (id, link) =>
      writeCard(id, (card, stamp) => {
        if (sameLink(card.host, link) && !card.hostNote) return card;
        const { hostNote: _note, ...rest } = card;
        const sent = sameLink(card.host, link) ? [] : [{ at: stamp, kind: 'sent' as const, text: `${link.project}#${link.iid}` }];
        return { ...rest, host: link, updatedAt: sent.length ? stamp : card.updatedAt, history: [...card.history, ...sent] };
      }),
    note: (id, note) =>
      writeCard(id, (card, stamp) => {
        if (note === null) {
          if (!card.hostNote) return card;
          const { hostNote: _note, ...rest } = card;
          return rest;
        }
        if (card.hostNote && card.hostNote.kind === note.kind && card.hostNote.text === note.text) return card;
        return { ...card, hostNote: { ...note, at: stamp } };
      }),
    mirror: (id, seen, ctx) => writeCard(id, (card, stamp) => applyMirror(card, mirrorOf(card, seen, ctx), stamp)),
  };
}
