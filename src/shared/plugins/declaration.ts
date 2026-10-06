import { ARTIFACT_NAME } from '../runs/output';
import { isPluginEvent, type PluginEvent } from './events';

// A plugin's declaration (plugin.json), read and judged by a pure function: it gets the text of the file and the folder the file was
// read from, and returns either what the plugin offers or the reason it was refused. Nothing here touches the file system, the process
// or the machine, so the same code path runs on Linux, macOS and Windows (nothing of a native loader is involved).
//
// The declaration is small: who the plugin is, which contract version it follows, and what it offers. Everything it may reach is a
// declaration; what it may actually do is decided by the app from what the person granted.

/** The contract version this app understands. A declaration of another version is refused with the reason. */
export const PLUGIN_CONTRACT = 1;

export const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A document type a plugin adds to the cycle folder: a base name and the label it appears under. */
export interface PluginDocumentType {
  /** Base name of the document, as the cycle folder takes it (no folder, nothing starting with a dot). */
  name: string;
  /** Label shown where the type is listed (a catalog key or a literal). */
  label: string;
}

/** What the plugin says it offers. */
export interface PluginOffers {
  /** Events of the fixed catalog it observes. */
  events: PluginEvent[];
  /** Document types it adds to the cycle folder. */
  documents: PluginDocumentType[];
  /** Host names it declares it needs from the network. */
  network: string[];
  /** Neutral destination of the external write of its example (never a named third-party service). */
  write: string | null;
  /** Script the app runs when an observed event happens, relative to the plugin folder. null: the plugin only offers documents. */
  entry: string | null;
}

export interface PluginDeclaration {
  id: string;
  name: string;
  contract: number;
  offers: PluginOffers;
}

export interface PluginReading {
  /** The plugin, or null when it was refused. */
  declaration: PluginDeclaration | null;
  /** Why it was refused, in words; null when it is usable. */
  refused: string | null;
}

const REASONS = {
  empty: 'the declaration is empty',
  notJson: 'the declaration is not valid JSON',
  notObject: 'the declaration is not an object',
  missingName: 'the declaration has no name',
  missingId: 'the declaration has no identity',
  badId: 'the identity is not a plugin id (lowercase letters, digits, "." and "-")',
  contract: 'the contract version is not one this app understands',
  event: 'the declaration observes an event outside the fixed catalog',
  document: 'a document name is not one the cycle folder takes',
  write: 'the write destination is not a plain destination',
  entry: 'the entry script is not a plain file name inside the plugin folder',
  network: 'a network destination is not a host name',
} as const;

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A path that stays inside the plugin folder: relative, no "..", no leading slash and no drive letter. */
function escapes(folder: string): boolean {
  if (!folder || folder.startsWith('/') || folder.startsWith('\\')) return true;
  if (/^[A-Za-z]:/.test(folder)) return true;
  return folder.split(/[\\/]/).includes('..');
}

/** A host name the app would accept for the network, or null. */
const HOST = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

/**
 * Reads a plugin declaration. `folder` is the plugin's own folder; nothing in the declaration may lead outside it.
 * Refusals, each with its own reason: no name, no identity, a contract version this app does not know, an event
 * outside the catalog, a document name the cycle folder would not take, a write destination or an entry script
 * that escapes the folder, and a network destination that is not a host name.
 */
export function readPluginDeclaration(text: string, folder: string): PluginReading {
  const refuse = (refused: string): PluginReading => ({ declaration: null, refused });
  if (!text.trim()) return refuse(REASONS.empty);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(REASONS.notJson);
  }
  const doc = asObject(raw);
  if (!doc) return refuse(REASONS.notObject);

  const name = str(doc.name);
  if (!name) return refuse(REASONS.missingName);
  const id = str(doc.id);
  if (!id) return refuse(REASONS.missingId);
  if (!PLUGIN_ID.test(id)) return refuse(REASONS.badId);

  const contract = typeof doc.contract === 'number' ? doc.contract : PLUGIN_CONTRACT;
  if (contract !== PLUGIN_CONTRACT) return refuse(REASONS.contract);

  const offers = asObject(doc.offers) ?? {};
  const events: PluginEvent[] = [];
  for (const e of list(offers.events)) {
    const n = str(e);
    if (!isPluginEvent(n)) return refuse(REASONS.event);
    if (!events.includes(n)) events.push(n);
  }

  const documents: PluginDocumentType[] = [];
  for (const d of list(offers.documents)) {
    const o = asObject(d);
    const docName = o ? str(o.name) : '';
    if (!docName || !ARTIFACT_NAME.test(docName)) return refuse(REASONS.document);
    documents.push({ name: docName, label: o ? str(o.label) || docName : docName });
  }

  const network: string[] = [];
  for (const h of list(offers.network)) {
    const host = str(h).toLowerCase();
    if (!HOST.test(host)) return refuse(REASONS.network);
    if (!network.includes(host)) network.push(host);
  }

  const write = str(offers.write);
  if (write && escapes(write)) return refuse(REASONS.write);

  const entry = str(offers.entry);
  if (entry && (escapes(entry) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry))) return refuse(REASONS.entry);

  return { declaration: { id, name, contract, offers: { events, documents, network, write: write || null, entry: entry || null } }, refused: null };
}
