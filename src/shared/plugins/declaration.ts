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

/**
 * The external write a plugin declares: the neutral destination it goes to (a plain name, never a third-party service) and whether it can be undone.
 * A write that does not say is irreversible: it may only be allowed "always", and it is announced with a deadline before it goes out.
 */
export interface PluginWrite {
  to: string;
  reversible: boolean;
}

/** A value the person fills in for the plugin, on the computer. A `secret` goes to the secrets store by reference and never reaches the plugin. */
export interface PluginSetting {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'secret';
  required: boolean;
}

/** Where the app puts a secret in a request it makes for the plugin. */
export interface PluginRequestSecret {
  /** The `secret` setting whose value goes in. */
  setting: string;
  in: 'header' | 'query';
  /** The header or query parameter name. */
  name: string;
  /** How the value is written, with `{secret}` where it goes ("Bearer {secret}"). */
  format: string;
}

/**
 * A request a JavaScript plugin may ask the app to make. `url` is absolute (`https://host/path`) or starts with `{settings.<key>}` of a `url` setting
 * (then the person's own address, local ones included). The path declared is the prefix the plugin may extend. Without `write`, it is a read.
 */
export interface PluginRequestDecl {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  secret: PluginRequestSecret | null;
  write: boolean;
  /** For a write: whether it can be undone; silence is irreversible. */
  reversible: boolean;
}

/** What the plugin says it offers. */
export interface PluginOffers {
  /** Events of the fixed catalog it observes. */
  events: PluginEvent[];
  /** Document types it adds to the cycle folder. */
  documents: PluginDocumentType[];
  /** Host names it declares it needs from the network. */
  network: string[];
  /** The external write it asks for, or null when it writes nothing outside the cycle folder. */
  write: PluginWrite | null;
  /** Script the app runs when an observed event happens, relative to the plugin folder. null: the plugin only offers documents. */
  entry: string | null;
  /** How the entry runs: a shell script, or a JavaScript module (`.mjs`) the app runs with its own runtime. */
  runtime: 'shell' | 'js';
  /** Values the person fills in (JavaScript plugins only). */
  settings: PluginSetting[];
  /** Requests the plugin may ask the app to make (JavaScript plugins only). */
  requests: PluginRequestDecl[];
  /** A short note the app adds to the context of every stage while the plugin is on, marked as the plugin's: what it offers the agents. */
  agents: string | null;
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
  write: 'the write destination is not a plain name',
  entry: 'the entry script is not a plain file name inside the plugin folder',
  network: 'a network destination is not a host name',
  setting: 'a setting has no plain key, a repeated key or a kind other than text, url or secret',
  request: 'a request has no plain id, a repeated id, a method other than GET, POST, PUT, PATCH or DELETE, or an address that is not https:// or a url setting',
  requestSecret: 'a request puts a secret that is not a secret setting, or in a place other than a header or a query parameter',
  needsJs: 'settings and requests need a JavaScript entry (.mjs)',
  agents: 'the note to the agents is not text, or is longer than 1000 characters',
  readMethod: 'a request with a method other than GET has to be declared a write',
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

/** A plain file name: what an entry script and a write destination are, so neither can lead out of where the app puts them. */
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const SETTING_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const REQUEST_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const METHODS: PluginRequestDecl['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * A declared request address: `https://` with a host name (no credentials, query or fragment), or `{settings.<key>}` of a declared `url` setting
 * followed by nothing or a path.
 */
function requestUrlOk(url: string, settings: PluginSetting[]): boolean {
  const fromSetting = /^\{settings\.([A-Za-z][A-Za-z0-9_]{0,39})\}(\/[^?#\s]*)?$/.exec(url);
  if (fromSetting) return settings.some((x) => x.key === fromSetting[1] && x.kind === 'url');
  try {
    const u = new URL(url);
    // A host name, never an address or a local name: what a declared request reaches is public (the address is checked again when it connects).
    const literal = /^\d+(\.\d+){3}$/.test(u.hostname) || u.hostname.startsWith('[');
    const local = u.hostname === 'localhost' || /\.(localhost|local|internal)$/.test(u.hostname) || !u.hostname.includes('.');
    return u.protocol === 'https:' && HOST.test(u.hostname) && !literal && !local && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
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

  // The short form (a name) is the irreversible write: the closed reading of a declaration that says nothing about undoing it.
  const rawWrite = asObject(offers.write);
  const to = rawWrite ? str(rawWrite.to) : str(offers.write);
  if (to && !PLAIN_NAME.test(to)) return refuse(REASONS.write);
  const write: PluginWrite | null = to ? { to, reversible: rawWrite?.reversible === true } : null;

  const entry = str(offers.entry);
  if (entry && (escapes(entry) || !PLAIN_NAME.test(entry))) return refuse(REASONS.entry);
  const runtime: 'shell' | 'js' = entry.endsWith('.mjs') ? 'js' : 'shell';

  const settings: PluginSetting[] = [];
  for (const raw of list(offers.settings)) {
    const o = asObject(raw);
    const key = o ? str(o.key) : '';
    const kind = o ? str(o.kind) : '';
    if (!SETTING_KEY.test(key) || settings.some((x) => x.key === key) || (kind !== 'text' && kind !== 'url' && kind !== 'secret')) return refuse(REASONS.setting);
    // A secret is stored as `plugin.<id>.<key>`, and a reference has at most 64 characters.
    if (kind === 'secret' && `plugin.${id}.${key}`.length > 64) return refuse(REASONS.setting);
    settings.push({ key, label: str(o?.label) || key, kind, required: o?.required === true });
  }

  const requests: PluginRequestDecl[] = [];
  for (const raw of list(offers.requests)) {
    const o = asObject(raw);
    const reqId = o ? str(o.id) : '';
    const method = (o ? str(o.method) : '').toUpperCase() || 'GET';
    const url = o ? str(o.url) : '';
    if (!REQUEST_ID.test(reqId) || requests.some((x) => x.id === reqId) || !METHODS.includes(method as PluginRequestDecl['method']) || !requestUrlOk(url, settings)) return refuse(REASONS.request);
    const rawSecret = asObject(o?.secret);
    let secret: PluginRequestSecret | null = null;
    if (rawSecret) {
      const setting = str(rawSecret.setting);
      const where = str(rawSecret.in) || 'header';
      const paramName = str(rawSecret.name);
      const format = str(rawSecret.format) || '{secret}';
      if (!settings.some((x) => x.key === setting && x.kind === 'secret') || (where !== 'header' && where !== 'query') || !/^[A-Za-z0-9_-]{1,64}$/.test(paramName) || !format.includes('{secret}')) return refuse(REASONS.requestSecret);
      secret = { setting, in: where, name: paramName, format };
    }
    const isWrite = o?.write === true;
    // Only a GET is a read: anything else changes something on the other side, so it has to be declared a write and go through the write's permission.
    if (method !== 'GET' && !isWrite) return refuse(REASONS.readMethod);
    requests.push({ id: reqId, method: method as PluginRequestDecl['method'], url, secret, write: isWrite, reversible: isWrite && o?.reversible === true });
  }
  if ((settings.length || requests.length) && runtime !== 'js') return refuse(REASONS.needsJs);

  if (offers.agents !== undefined && typeof offers.agents !== 'string') return refuse(REASONS.agents);
  const agents = str(offers.agents);
  if (agents.length > 1000) return refuse(REASONS.agents);

  return { declaration: { id, name, contract, offers: { events, documents, network, write, entry: entry || null, runtime, settings, requests, agents: agents || null } }, refused: null };
}
