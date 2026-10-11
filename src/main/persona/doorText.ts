// The texts the persona's door returns to its model (#248): fixed English, like the descriptions of the tools, whatever language the person reads the app in. They are never shown to the
// person (the chat words its lines from the facts in the viewer's catalog), so they are not in the catalogs; one set means the model reads the same refusal in every workspace.

// i18n-ignore-start: text the persona's model reads: English by design, like the tool descriptions
const TEXTS = {
  unknownTool: "There is no tool {tool}. Stopping and resuming the persona are the person's; nothing here changes them.",
  unknownOp: "{tool} has no operation {op}. Its operations are: {ops}. Stopping and resuming the persona are the person's; nothing here changes them.",
  stopped: "The persona is stopped. Nothing is done until the person resumes it.",
  done: "Done.",
  refused: "{tool}.{op} was refused: {reason}",
  failed: "{tool}.{op} failed: {reason}",
  noCard: "No card has the reference {ref}. Some that are loaded: {list}.",
  'arg.unknown': "{name} is not an argument of this operation. Its arguments: {args}.",
  'arg.required': "The argument {name} is missing: the operation needs it.",
  'arg.type': "{name} must be of type {type}.",
  'arg.long': "{name} is too long: at most {max} characters.",
  'arg.enum': "{name} must be one of: {values}.",
  'arg.why': "An operation that changes something takes a reason (why): one sentence of at most {max} characters.",
  'path.syntax': "The path {path} is not valid: use dot-separated keys, and name[id] to pick an element of a list.",
  'path.forbidden': "The path {path} names a key that cannot be set.",
  'path.missing': "Nothing exists at the path {path}, or what is above it does not exist.",
  'path.type': "The path {path} points at something of another kind than the change needs.",
  'board.twoTargets': "Name the card by id, or the issue by project and iid, not both.",
  'board.noTarget': "Name the card by id, or the issue by project and iid.",
  'guard.testOnly': "The test-only mark of the test-environment secret {ref} is the person's to give: a secret that is not test-only waits for their confirmation, and that is not something to change from here.",
  'guard.mcpState': "The MCP servers switch is the computer's, not the persona's: it is not changed from here.",
  'guard.ownEntry': "The persona's own entry in the team is not removed from here: clearing or deleting the persona is the person's.",
  'guard.ownEdit': "The persona's name, kind and instructions are edited in its editor by the person, not from here. Its reach (permission, shell, tracker, screen, hosts) can be changed.",
  'terminal.off': "The persona's tools are off for terminal sessions in this workspace. The person turns them on in the app, in Settings, under the local state server; nothing here changes that.",
  'terminal.noPersona': "This workspace has no persona, so there is no door to act through. The person makes one in the app.",
  'terminal.badRequest': "The app did not understand the request.",
  'terminal.failed': "The app could not run the call: {reason}",
  'terminal.closed': "The app is not open for this workspace, so nothing was done. Ask the person to open it.",
  'terminal.token': "The app refused the call: the terminal session's key does not match the one the app holds now. Restart the session's MCP server.",
  'terminal.timeout': "The app did not answer in time; the call may still finish there. Read the state before trying it again.",
  'terminal.broken': "The connection to the app was lost; the call may or may not have run. Read the state before trying it again.",
} as const;
// i18n-ignore-end

export type DoorTextKey = keyof typeof TEXTS;
export type DoorTextParams = Record<string, string | number>;

/** A door text with its `{name}` slots filled; a slot with no value is left empty. */
export function doorText(key: DoorTextKey, params: DoorTextParams = {}): string {
  return TEXTS[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}
