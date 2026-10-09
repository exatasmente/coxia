import { RESULT_MAX, type HeldAnswer, type HoldWhy, type StepClass, type StepOutcome } from '../../shared/browser';
import { HANDOFF_HELD_TEXT } from '../../shared/handoff';
import { t } from '../../shared/i18n';
import type { EffectiveNetwork } from '../../shared/network';
import { fence } from '../runner/prompt';
import { type ArgProblem, type ExposedTool, checkArguments, exposedTool, toolsFor } from './allowlist';
import { type Classification, type StepWords, classify, needsTarget } from './classify';
import type { HostsTally } from './hosts';
import type { McpClient } from './mcpClient';
import type { MaskSet } from './mask';
import { type PageRead, type ProbeClient, type TargetInfo, readFocus, readPage, readTarget, snapshotText } from './probe';
import { siteOf } from './audit';
import { type StepLog, pathOf } from './stepLog';

// The app between an agent and the Playwright MCP server. Every call of the agent passes here, in this order: the arguments are checked against the schema the app wrote; a
// web address is checked (http and https only, a host the agent may reach); the page is read by the app itself and the step is classified; a step that cannot be undone, or that
// the app cannot read, waits for the person; only then is it forwarded; what comes back is taken from the app's own snapshot of the page, masked, cut and put inside a data
// fence; and the step goes into the log. The agent never talks to the server, and the server's tools that would step around any of this are not offered at all.

/** A step the app holds, as the person will be asked about it. */
export interface HoldRequest {
  why: HoldWhy;
  /** The step in the app's words, read from the page. */
  step: StepWords;
  /** The host of the page the step acts on. */
  site: string;
  /** What the agent wrote about the step, as its own words. */
  agentWords?: string;
}

/** What the intermediary needs of the people side: the question, and the passes the person gave for steps the app could not read. */
export interface HoldGate {
  /** Asks the person and waits. Aborting the signal counts as `closed`. Never throws. */
  hold(request: HoldRequest, signal?: AbortSignal): Promise<HeldAnswer>;
  /** Whether the person gave a pass for unclassifiable steps on this site, for this screen. */
  passed(site: string): boolean;
}

/** What a call comes back as, for an engine to put in its own shape. */
export interface BrowserResult {
  /** The text for the model: the app's words, and the page's text inside a data fence. */
  text: string;
  /** Pictures (a screenshot) the model may look at; only where the engine takes images. */
  images: { data: string; mimeType: string }[];
  isError: boolean;
}

export interface IntermediaryDeps {
  /** The server. Only the app holds it. */
  client: Pick<McpClient, 'callTool'> & ProbeClient;
  network: Pick<EffectiveNetwork, 'mode' | 'hosts'>;
  hosts: HostsTally;
  masks: MaskSet;
  log: StepLog;
  gate: HoldGate;
  /** Whether the engine takes images. */
  seesImages: boolean;
  /** Paths of this computer the server's words must not carry to the agent (its output folder): each is replaced by an ellipsis. */
  hide?: string[];
  /** Told when a call starts and ends, whatever became of it (a screen with a step in progress is not idle). */
  onStep?: (phase: 'start' | 'end', tool: string) => void;
  now?: () => number;
  resultMax?: number;
}

export interface CallOptions {
  /** Stops the call: a wait for the person ends as `closed`, a step in the browser is abandoned. */
  signal?: AbortSignal;
  /**
   * The person has the screen for a hand-off (#178) while this answers true: the call is refused with a fixed sentence before anything is read or done, and is not a step. It is
   * asked when the call arrives and again when its turn comes, since a call queued behind a slow one may start after the person took the screen. A call that was already in the
   * browser when the person took it is asked once more before the server is called and after it answers: its page is dropped (the step is logged `not-run`).
   */
  held?: () => boolean;
}

export interface Intermediary {
  /** The tools to offer the agent. */
  tools(): ExposedTool[];
  /** Runs one call. Calls are taken one at a time, in the order they came. Never throws. */
  call(tool: string, args: unknown, options?: CallOptions): Promise<BrowserResult>;
  /** After this every call is refused; whatever waits for the person is the gate's to decline. */
  close(): void;
}

const IMAGE_MAX_CHARS = 6 * 1024 * 1024;
const SHOWN_HOSTS = 5;

/** How long the server may take for a tool (ms): a navigation is allowed the server's own 60 s and a wait up to its 30. */
const timeoutFor = (tool: string): number => (tool === 'browser_navigate' ? 75_000 : tool === 'browser_wait_for' ? 40_000 : 30_000);

export const problemText = (p: ArgProblem): string => {
  if (p.code === 'unknown-tool') return t('main.browser.reason.unknownTool');
  if (p.code === 'not-object') return t('main.browser.reason.argument.notObject');
  const key = p.code === 'unknown-property' ? 'unknown' : p.code === 'not-a-ref' ? 'notRef' : p.code;
  return t(`main.browser.reason.argument.${key}`, { name: p.name });
};

const refusal = (text: string): BrowserResult => ({ text, images: [], isError: true });

type UrlCheck = { ok: true; url: URL } | { ok: false; text: string };

/** The check every address the agent asks to open passes: a web address, to a host it may reach. The proxy is the boundary; this says why, in words, before the browser is asked. */
export function checkAddress(raw: string, network: Pick<EffectiveNetwork, 'mode' | 'hosts'>): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, text: t('main.browser.reason.badUrl') };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, text: t('main.browser.reason.scheme') };
  // On the computer's own network the whole web is the agent's, as it is the person's.
  if (network.mode === 'open') return { ok: true, url };
  const host = url.hostname.toLowerCase();
  if (network.mode === 'off' || !network.hosts.includes(host)) {
    return { ok: false, text: network.hosts.length ? t('main.browser.reason.host', { host: host.slice(0, 100), hosts: network.hosts.join(', ') }) : t('main.browser.reason.noHosts', { host: host.slice(0, 100) }) };
  }
  return { ok: true, url };
}

/** Only a host name as DNS writes it reaches the agent's eyes outside the data fence: what a page made the browser ask for is not the app's text. */
const safeHost = (h: string): string | null => (/^[a-z0-9]([a-z0-9.-]{0,78}[a-z0-9])?$/.test(h) ? h : null);

export function createIntermediary(d: IntermediaryDeps): Intermediary {
  const now = d.now ?? Date.now;
  const resultMax = d.resultMax ?? RESULT_MAX;
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  // The page the browser was last seen on: where a step that needed no reading of its own is said to have been taken.
  let lastUrl = '';

  /** Page text: masked, cut to the cap and put inside the fence. */
  function finishText(text: string): string {
    let shown = text;
    for (const path of d.hide ?? []) if (path) shown = shown.split(path).join('…');
    const masked = d.masks.apply(shown);
    if (masked === null) return t('main.browser.reason.maskFailed');
    const cut = masked.length > resultMax ? `${masked.slice(0, resultMax)}\n${t('main.browser.result.cut', { max: resultMax })}` : masked;
    return `<data>\n${fence(cut)}\n</data>`;
  }

  /** What of a step comes from the page goes through the masks too, so a typed value is in no step the procedure memory reads. */
  const cleaned = (entry: { site: string; path: string; name?: string }): { site: string; path: string; name?: string } => {
    const mask = (text: string): string => (text ? (d.masks.apply(text) ?? '') : text);
    return { site: mask(entry.site), path: mask(entry.path), ...(entry.name ? { name: mask(entry.name) } : {}) };
  };

  async function run(tool: string, rawArgs: unknown, signal?: AbortSignal, held?: () => boolean): Promise<BrowserResult> {
    // The first line of every call: while the person has the screen nothing is read, done or recorded, and the agent is not told what changed.
    if (held?.()) return refusal(HANDOFF_HELD_TEXT);
    const started = now();
    const at = new Date(started).toISOString();
    const entry: { site: string; path: string; class: StepClass; role?: string; name?: string; key?: string; reason?: string; held?: { why: HoldWhy; answer: HeldAnswer }; passed?: true; outcome: StepOutcome } = {
      site: '',
      path: '',
      class: 'unclassified',
      outcome: 'not-run',
    };
    if (lastUrl) {
      entry.site = siteOf(lastUrl);
      entry.path = pathOf(lastUrl);
    }
    const endCall = d.hosts.beginCall();
    d.onStep?.('start', tool);
    const finish = (result: BrowserResult, outcome: StepOutcome): BrowserResult => {
      entry.outcome = outcome;
      // The hosts the proxy refused while this call ran, so the agent knows why a page is missing parts.
      const refused = endCall()
        .map(safeHost)
        .filter((h): h is string => h !== null)
        .slice(0, SHOWN_HOSTS);
      d.log.add({ tool, ...entry, ...cleaned(entry), at, ms: now() - started });
      d.onStep?.('end', tool);
      return refused.length ? { ...result, text: `${result.text}\n${t('main.browser.result.hosts', { hosts: refused.join(', ') })}` } : result;
    };

    try {
      if (closed) return finish(refusal(t('main.browser.reason.closed')), 'not-run');
      if (signal?.aborted) return finish(refusal(t('main.browser.reason.stopped')), 'not-run');

      // 1. The arguments, against the schema the app wrote. A selector in place of a ref ends here.
      const checked = checkArguments(tool, rawArgs);
      if (!checked.ok) return finish(refusal(problemText(checked.problem)), 'not-run');
      const spec = exposedTool(tool) as ExposedTool;
      if (spec.image && !d.seesImages) return finish(refusal(t('main.browser.reason.noImages')), 'not-run');
      const args = checked.forward;
      if (checked.reason) entry.reason = checked.reason;

      // 2. A web address, to a host the agent may reach.
      const address = tool === 'browser_navigate' ? String(args.url) : tool === 'browser_tabs' && args.action === 'new' && typeof args.url === 'string' ? args.url : null;
      let page: PageRead | null = null;
      if (address !== null) {
        const ok = checkAddress(address, d.network);
        if (!ok.ok) {
          entry.site = siteOf(address);
          return finish(refusal(ok.text), 'not-run');
        }
        entry.site = ok.url.hostname.toLowerCase();
        entry.path = pathOf(ok.url.href);
      }

      // 3. The page, read by the app itself, and the step classified from what it says (never from what the agent said of it).
      const need = needsTarget(tool, args);
      let target: TargetInfo | null = null;
      let focus: TargetInfo | null = null;
      if (need) {
        page = await readPage(d.client, signal);
        if (page?.url) {
          lastUrl = page.url;
          entry.site = siteOf(page.url);
          entry.path = pathOf(page.url);
        }
        if (need === 'target' && page) {
          const found = await readTarget(d.client, page, String(args.target), signal);
          if (found === 'stale') return finish(refusal(t('main.browser.reason.stale', { ref: String(args.target) })), 'not-run');
          target = found;
        } else if (need === 'focus' && page) {
          focus = await readFocus(d.client, page, signal);
        }
      }
      const c: Classification = classify({ tool, args, target, focus });
      entry.class = c.class;
      // A step that is held names the site it acts on, whether or not the step needed the page for its class.
      if (c.class !== 'free' && !entry.site) {
        page ??= await readPage(d.client, signal);
        if (page?.url) {
          lastUrl = page.url;
          entry.site = siteOf(page.url);
          entry.path = pathOf(page.url);
        }
      }
      const seen = target ?? focus;
      if (seen?.role) entry.role = seen.role;
      if (seen?.name) entry.name = seen.name;
      if (c.words.key) entry.key = c.words.key;

      // 4. Held for the person: what cannot be undone, and what the app cannot read unless the person gave a pass for the site.
      if (c.class !== 'free') {
        if (c.class === 'unclassified' && d.gate.passed(entry.site)) {
          entry.passed = true;
        } else {
          const answer = await d.gate.hold({ why: c.why ?? 'unclassified', step: c.words, site: entry.site, ...(checked.reason ? { agentWords: checked.reason } : {}) }, signal);
          entry.held = { why: c.why ?? 'unclassified', answer };
          if (answer !== 'yes' && answer !== 'site') {
            const key = answer === 'timeout' ? 'timeout' : answer === 'closed' ? 'closed' : 'declined';
            return finish(refusal(t(`main.browser.reason.${key}`)), 'declined');
          }
          // The page may have changed while the person thought it over: the step is done only on the element the person was asked about.
          if (need === 'target' && target) {
            const fresh = await readPage(d.client, signal);
            const again = fresh ? await readTarget(d.client, fresh, target.ref, signal) : 'stale';
            if (again === 'stale' || again.role !== target.role || again.name !== target.name) return finish(refusal(t('main.browser.reason.changed')), 'not-run');
          }
        }
      }

      // A picture cannot be masked: when the page shows what the person typed, as text, the picture is refused and the text read is the way.
      if (tool === 'browser_take_screenshot' && d.masks.size > 0) {
        const shown = await readPage(d.client, signal);
        const masked = shown ? d.masks.apply(shown.answer) : null;
        if (!shown || masked === null) return finish(refusal(t('main.browser.reason.maskFailed')), 'not-run');
        if (masked !== shown.answer) return finish(refusal(t('main.browser.reason.shownTyped')), 'not-run');
      }

      // 5. The server. The person may have taken the screen while the app read the page or waited for an answer: nothing is sent to a screen that is no longer the agent's.
      const taken = (): boolean => held?.() === true;
      if (taken()) return finish(refusal(HANDOFF_HELD_TEXT), 'not-run');
      let answer: Awaited<ReturnType<McpClient['callTool']>>;
      try {
        answer = await d.client.callTool(tool, args, { timeoutMs: timeoutFor(tool), signal });
      } catch (e) {
        const code = (e as { code?: string }).code;
        const text = code === 'aborted' ? t('main.browser.reason.stopped') : code === 'timeout' ? t('main.browser.reason.slow') : t('main.browser.reason.failed');
        return finish(refusal(text), 'error');
      }
      // A call already in the browser when the person took the screen comes back with the page as it was before their typing was known: it is dropped, not masked.
      if (taken()) return finish(refusal(HANDOFF_HELD_TEXT), 'not-run');
      const serverText = answer.content.map((x) => (x.type === 'text' && typeof (x as { text?: unknown }).text === 'string' ? String((x as { text: string }).text) : '')).filter(Boolean).join('\n');
      const images = answer.content
        .filter((x): x is { type: 'image'; data: string; mimeType: string } => x.type === 'image' && typeof (x as { data?: unknown }).data === 'string')
        .map((x) => ({ data: x.data, mimeType: String((x as { mimeType?: unknown }).mimeType ?? 'image/png') }));

      // 6. What comes back. The page's snapshot is the app's own, taken after an action; a picture's text is the app's, because the server's names a file of its own folder.
      let body = serverText;
      if (tool === 'browser_take_screenshot') body = '';
      else if (spec.kind === 'act' && !answer.isError) {
        const after = await readPage(d.client, signal);
        if (after) {
          if (after.url) lastUrl = after.url;
          body = `${serverText.split('### Snapshot')[0].trimEnd()}\n### Snapshot\n\`\`\`yaml\n${snapshotText(after.answer)}\n\`\`\``;
        }
      } else if (tool === 'browser_snapshot' || tool === 'browser_find') {
        const url = /^- Page URL: (\S+)/m.exec(serverText)?.[1];
        if (url) {
          lastUrl = url;
          entry.site = siteOf(url);
          entry.path = pathOf(url);
        }
      }
      // The read after an action is one more await in which the screen may have been taken.
      if (taken()) return finish(refusal(HANDOFF_HELD_TEXT), 'not-run');
      const parts: string[] = [];
      if (tool === 'browser_take_screenshot') parts.push(images.length ? t('main.browser.result.screenshot') : t('main.browser.result.noScreenshot'));
      else parts.push(finishText(body));
      const sent = images.filter((i) => i.data.length <= IMAGE_MAX_CHARS);
      if (images.length > sent.length) parts.push(t('main.browser.result.imageTooBig'));
      return finish({ text: parts.join('\n'), images: d.seesImages ? sent : [], isError: answer.isError === true }, answer.isError ? 'error' : 'ok');
    } catch (e) {
      console.error('[browser] a call failed in the app', e instanceof Error ? e.message : e);
      return finish(refusal(t('main.browser.reason.failed')), 'error');
    }
  }

  return {
    tools: () => toolsFor(d.seesImages),
    call(tool, args, options) {
      if (options?.held?.()) return Promise.resolve(refusal(HANDOFF_HELD_TEXT));
      const next = queue.then(() => run(tool, args, options?.signal, options?.held));
      queue = next.catch(() => undefined);
      return next;
    },
    close() {
      closed = true;
    },
  };
}
