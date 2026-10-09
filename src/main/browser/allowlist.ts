// i18n-lint: allow-file what the app's browser tools tell a model: English by design, like the other tool texts of the engines
// The tools of the Playwright MCP server the app offers an agent, and the ones it never does. The server offers whatever its version has; the agent gets only the tools
// named here, with schemas the app wrote (not the server's): every acting tool takes a ref and nothing else as its target, no tool takes a file name, and `reason` is the
// app's own property, read by the intermediary and never forwarded. Pure data and a validator, so the contract test, both engines' tool shapes and the intermediary read the
// same table.

/** What a `target` must look like: a ref of the page's last snapshot (`e7`, or `f1e3` inside a frame). A selector would step around what the app reads of the target. */
export const REF_PATTERN = '^(f\\d+)?e\\d+$';
const REF_RE = new RegExp(REF_PATTERN);
/** What a `key` must look like: no whitespace or control character, but for the one Playwright reads as Enter (a line break) or Space, at the end. */
export const KEY_PATTERN = '^[^\\s\\x00-\\x1f\\x7f-\\x9f]*[\\n\\r ]?$';
export const isRef = (value: unknown): value is string => typeof value === 'string' && REF_RE.test(value);

export type PropType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface Prop {
  type: PropType;
  description: string;
  enum?: readonly string[];
  pattern?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  items?: Prop;
  properties?: Record<string, Prop>;
  required?: readonly string[];
  /** The app's own property: read by the intermediary, never sent to the server. */
  appOnly?: true;
}

export type ToolKind = 'read' | 'act';

export interface ExposedTool {
  /** The server's name for it (the Claude SDK shows it as `mcp__coxia_browser__<name>`). */
  name: string;
  /** `read` tools only read the page or wait; `act` tools change it or the browser. */
  kind: ToolKind;
  description: string;
  properties: Record<string, Prop>;
  required: readonly string[];
  /** The tool returns a picture: offered only where the engine takes images. */
  image?: true;
}

const ELEMENT: Prop = { type: 'string', maxLength: 200, description: 'A few words saying what the element is (for the person who follows your work).' };
const TARGET: Prop = { type: 'string', pattern: REF_PATTERN, description: 'The ref of the element in your last snapshot, exactly as the snapshot shows it (for example e7). A selector is refused.' };
const REASON: Prop = { type: 'string', maxLength: 200, appOnly: true, description: 'Optional: why you take this step, in one short sentence. The person sees it if the step has to be confirmed.' };
const SNAPSHOT_FIRST = ' Take a snapshot first: the refs it shows are the only way to name an element, and they change when the page does.';

export const EXPOSED_TOOLS: readonly ExposedTool[] = [
  {
    name: 'browser_navigate',
    kind: 'act',
    description: 'Opens an address in the current tab. Only http and https addresses of the hosts you were allowed are reachable.',
    properties: { url: { type: 'string', maxLength: 2048, description: 'The address to open.' }, reason: REASON },
    required: ['url'],
  },
  {
    name: 'browser_navigate_back',
    kind: 'act',
    description: 'Goes back to the previous page of the current tab.',
    properties: { reason: REASON },
    required: [],
  },
  {
    name: 'browser_snapshot',
    kind: 'read',
    description: 'Reads the current page as a tree of roles and names, each element with a ref. This is how you see the page, and it is better than a screenshot for acting.',
    properties: { target: { ...TARGET, description: 'Optional: the ref of an element, to read only its part of the page.' }, depth: { type: 'integer', minimum: 1, maximum: 50, description: 'Optional: how deep to read the tree.' } },
    required: [],
  },
  {
    name: 'browser_find',
    kind: 'read',
    description: 'Searches the text of the current page snapshot for a word or a regular expression and returns the matching nodes with a little context.',
    properties: {
      text: { type: 'string', maxLength: 200, description: 'Plain text to search for (not case-sensitive). Give either text or regex.' },
      regex: { type: 'string', maxLength: 200, description: 'A regular expression (wrap it in slashes to add flags, like /error/i). Give either text or regex.' },
    },
    required: [],
  },
  {
    name: 'browser_click',
    kind: 'act',
    description: `Clicks an element. A click that sends, saves, deletes, publishes or pays is held until the person says yes.${SNAPSHOT_FIRST}`,
    properties: {
      element: ELEMENT,
      target: TARGET,
      doubleClick: { type: 'boolean', description: 'Double click instead of a single one.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Which button; left by default.' },
      modifiers: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'], description: 'A key held during the click.' }, description: 'Keys held during the click.' },
      reason: REASON,
    },
    required: ['target'],
  },
  {
    name: 'browser_type',
    kind: 'act',
    description: `Types text into an editable element. With submit it also presses Enter, which sends a form: that is held until the person says yes.${SNAPSHOT_FIRST}`,
    properties: {
      element: ELEMENT,
      target: TARGET,
      text: { type: 'string', maxLength: 20000, description: 'The text to type.' },
      submit: { type: 'boolean', description: 'Press Enter after the text.' },
      slowly: { type: 'boolean', description: 'Type one character at a time, to trigger key handlers in the page.' },
      reason: REASON,
    },
    required: ['target', 'text'],
  },
  {
    name: 'browser_press_key',
    kind: 'act',
    description: 'Presses a key or a chord (ArrowLeft, Enter, Escape, Control+A). Enter in a form field and a save or send shortcut are held until the person says yes.',
    properties: { key: { type: 'string', maxLength: 40, pattern: KEY_PATTERN, description: 'The key, like ArrowLeft or a. A chord joins its keys with +.' }, reason: REASON },
    required: ['key'],
  },
  {
    name: 'browser_fill_form',
    kind: 'act',
    description: `Fills several fields of a form. It does not send the form.${SNAPSHOT_FIRST}`,
    properties: {
      fields: {
        type: 'array',
        maxItems: 40,
        description: 'The fields to fill, in order.',
        items: {
          type: 'object',
          description: 'One field.',
          properties: {
            element: ELEMENT,
            target: TARGET,
            name: { type: 'string', maxLength: 200, description: 'The field\'s name, for the person who follows your work.' },
            type: { type: 'string', enum: ['textbox', 'checkbox', 'radio', 'combobox', 'slider'], description: 'The kind of field.' },
            value: { type: 'string', maxLength: 20000, description: 'The value; true or false for a checkbox; the text of the option for a combobox.' },
          },
          required: ['target', 'name', 'type', 'value'],
        },
      },
      reason: REASON,
    },
    required: ['fields'],
  },
  {
    name: 'browser_select_option',
    kind: 'act',
    description: `Selects one or more options of a dropdown.${SNAPSHOT_FIRST}`,
    properties: { element: ELEMENT, target: TARGET, values: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500, description: 'An option.' }, description: 'The options to select.' }, reason: REASON },
    required: ['target', 'values'],
  },
  {
    name: 'browser_hover',
    kind: 'act',
    description: `Moves the pointer over an element.${SNAPSHOT_FIRST}`,
    properties: { element: ELEMENT, target: TARGET, reason: REASON },
    required: ['target'],
  },
  {
    name: 'browser_drag',
    kind: 'act',
    description: `Drags one element onto another. The person is asked before it happens, because the app cannot tell what it does.${SNAPSHOT_FIRST}`,
    properties: {
      startElement: ELEMENT,
      startTarget: { ...TARGET, description: 'The ref of the element to drag.' },
      endElement: ELEMENT,
      endTarget: { ...TARGET, description: 'The ref of the element to drop it on.' },
      reason: REASON,
    },
    required: ['startTarget', 'endTarget'],
  },
  {
    name: 'browser_wait_for',
    kind: 'read',
    description: 'Waits for a text to appear or disappear, or for some seconds to pass.',
    properties: {
      time: { type: 'number', minimum: 0, maximum: 30, description: 'Seconds to wait, at most 30.' },
      text: { type: 'string', maxLength: 500, description: 'Wait until this text appears.' },
      textGone: { type: 'string', maxLength: 500, description: 'Wait until this text disappears.' },
    },
    required: [],
  },
  {
    name: 'browser_tabs',
    kind: 'act',
    description: 'Lists, opens, closes or selects a tab.',
    properties: {
      action: { type: 'string', enum: ['list', 'new', 'close', 'select'], description: 'What to do.' },
      index: { type: 'integer', minimum: 0, maximum: 100, description: 'The tab, for close and select.' },
      url: { type: 'string', maxLength: 2048, description: 'The address to open, for new.' },
      reason: REASON,
    },
    required: ['action'],
  },
  {
    name: 'browser_handle_dialog',
    kind: 'act',
    description: 'Answers a dialog the page opened (an alert, a confirm box, a prompt). Accepting is held until the person says yes.',
    properties: { accept: { type: 'boolean', description: 'Accept the dialog (true) or dismiss it (false).' }, promptText: { type: 'string', maxLength: 2000, description: 'The text, for a prompt.' }, reason: REASON },
    required: ['accept'],
  },
  {
    name: 'browser_take_screenshot',
    kind: 'read',
    image: true,
    description: 'Takes a picture of the page or of one element. You cannot act from a picture: use a snapshot for that.',
    properties: {
      element: ELEMENT,
      target: { ...TARGET, description: 'Optional: the ref of an element, to take only that.' },
      type: { type: 'string', enum: ['png', 'jpeg'], description: 'The image format; png by default.' },
      fullPage: { type: 'boolean', description: 'The whole scrollable page instead of the visible part.' },
    },
    required: [],
  },
];

/**
 * The tools of the server the app never offers. Each would let an agent step around what the app classifies, records or bounds: script in the page or the browser, files,
 * the browser's own network and console, a window size, or the browser's life. A name that is in neither list fails the contract test, so an upgrade cannot add one quietly.
 */
export const REFUSED_TOOLS: readonly string[] = [
  'browser_close',
  'browser_resize',
  'browser_console_messages',
  'browser_emulate_media',
  'browser_evaluate',
  'browser_file_upload',
  'browser_drop',
  'browser_network_requests',
  'browser_network_request',
  'browser_run_code_unsafe',
];

/** The two tools of the server the intermediary itself calls to read the page (never an agent's): a snapshot of its own, and one fixed read of an element. */
export const PROBE_TOOLS: readonly string[] = ['browser_snapshot', 'browser_evaluate'];

export const exposedTool = (name: string): ExposedTool | undefined => EXPOSED_TOOLS.find((t) => t.name === name);
export const exposedNames = (): string[] => EXPOSED_TOOLS.map((t) => t.name);

/** The tools an engine is offered: the picture tool only where the engine takes images. */
export const toolsFor = (seesImages: boolean): ExposedTool[] => EXPOSED_TOOLS.filter((t) => !t.image || seesImages);

/** The JSON schema of a tool as a model reads it. */
export function jsonSchemaOf(tool: ExposedTool): { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false } {
  const strip = (p: Prop): Record<string, unknown> => {
    const { appOnly: _appOnly, items, properties, required, ...rest } = p;
    return { ...rest, ...(items ? { items: strip(items) } : {}), ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, strip(v)])), required: [...(required ?? [])], additionalProperties: false } : {}) };
  };
  return { type: 'object', properties: Object.fromEntries(Object.entries(tool.properties).map(([k, v]) => [k, strip(v)])), required: [...tool.required], additionalProperties: false };
}

export type ArgProblem =
  | { code: 'unknown-tool' }
  | { code: 'not-object' }
  | { code: 'unknown-property'; name: string }
  | { code: 'missing'; name: string }
  | { code: 'type'; name: string }
  | { code: 'enum'; name: string }
  | { code: 'size'; name: string }
  | { code: 'range'; name: string }
  /** A `target` that is not a ref: a selector, which the app refuses. */
  | { code: 'not-a-ref'; name: string };

export type Checked = { ok: true; forward: Record<string, unknown>; reason?: string } | { ok: false; problem: ArgProblem };

function checkValue(prop: Prop, value: unknown, name: string): ArgProblem | null {
  switch (prop.type) {
    case 'string': {
      if (typeof value !== 'string') return { code: 'type', name };
      if (prop.maxLength !== undefined && value.length > prop.maxLength) return { code: 'size', name };
      if (prop.enum && !prop.enum.includes(value)) return { code: 'enum', name };
      if (prop.pattern && !new RegExp(prop.pattern).test(value)) return { code: prop.pattern === REF_PATTERN ? 'not-a-ref' : 'type', name };
      return null;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (prop.type === 'integer' && !Number.isInteger(value))) return { code: 'type', name };
      if ((prop.minimum !== undefined && value < prop.minimum) || (prop.maximum !== undefined && value > prop.maximum)) return { code: 'range', name };
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : { code: 'type', name };
    case 'array': {
      if (!Array.isArray(value)) return { code: 'type', name };
      if (prop.maxItems !== undefined && value.length > prop.maxItems) return { code: 'size', name };
      if (prop.items) for (const [i, item] of value.entries()) {
        const bad = checkValue(prop.items, item, `${name}[${i}]`);
        if (bad) return bad;
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return { code: 'type', name };
      const record = value as Record<string, unknown>;
      const props = prop.properties ?? {};
      for (const key of Object.keys(record)) if (!props[key]) return { code: 'unknown-property', name: `${name}.${key}` };
      for (const key of prop.required ?? []) if (record[key] === undefined) return { code: 'missing', name: `${name}.${key}` };
      for (const [key, p] of Object.entries(props)) {
        if (record[key] === undefined) continue;
        const bad = checkValue(p, record[key], `${name}.${key}`);
        if (bad) return bad;
      }
      return null;
    }
  }
}

/**
 * Checks what an agent sent against the tool's schema: no property the schema lacks, every required one present, each of the right type and size, every target a ref.
 * Returns the arguments to forward (without the app's own `reason`) and the reason the agent gave.
 */
export function checkArguments(toolName: string, args: unknown): Checked {
  const tool = exposedTool(toolName);
  if (!tool) return { ok: false, problem: { code: 'unknown-tool' } };
  return checkToolArguments(tool, args);
}

/** The same check for a tool of the app's own that is not a browser tool (the confirmation tool), against its own table row. */
export function checkToolArguments(tool: ExposedTool, args: unknown): Checked {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return { ok: false, problem: { code: 'not-object' } };
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!tool.properties[key]) return { ok: false, problem: { code: 'unknown-property', name: key } };
  for (const key of tool.required) if (record[key] === undefined) return { ok: false, problem: { code: 'missing', name: key } };
  const forward: Record<string, unknown> = {};
  let reason: string | undefined;
  for (const [key, prop] of Object.entries(tool.properties)) {
    const value = record[key];
    if (value === undefined) continue;
    const bad = checkValue(prop, value, key);
    if (bad) return { ok: false, problem: bad };
    if (prop.appOnly) reason = String(value);
    else forward[key] = value;
  }
  return { ok: true, forward, ...(reason ? { reason } : {}) };
}
