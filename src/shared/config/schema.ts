// i18n-lint: allow-file JSON Schema descriptions: English documentation of the config format, for whoever edits config.json
import type { JsonSchema } from './jsonSchema';
import { VERIFY_COMMAND_MAX } from '../verifyCommands';
import { ACTIVITIES, MAX_POOL_ENTRIES, POOL_MODES, SCORED_ACTIVITIES, AGENT_PERMISSIONS, AGENT_SHELLS, AGENT_TRACKERS, SANDBOX_NETWORKS, CARD_FIELDS, CEREMONY_IDS, CLI_PREFERENCES, EVIDENCE_PLACEMENTS, PROMPT_ROLES, STAGE_SOURCES, USER_ARTICLES, CONFIG_SCHEMA_VERSION, CARD_SCOPES, ENGINES, LANGUAGES, LLM_ROLES, PROVIDER_KINDS, STAGE_KINDS, STAGE_TYPES, STRUCTURED_MODES, THEMES, VCS_KINDS, VOICE_ENGINES, WAIT_KINDS } from './types';

// The JSON Schema of WorkspaceConfig (schema 25). It is both what `config:schema` hands to editors and what import validates against.
// Only the fields that cannot be guessed are required; everything else falls back to the neutral default (defaults.ts).

export const ID = '^[a-z0-9][a-z0-9_-]{0,47}$';
export const SECRET_REF = '^[a-z0-9][a-z0-9._-]{0,63}$';
export const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const NO_NUL = '^[^\\u0000]*$';
const ARTIFACT = '^[A-Za-z0-9][A-Za-z0-9._-]*$';
const PROVIDER_OR_EMPTY = '^([a-z0-9][a-z0-9_-]{0,47})?$';
// A card label is looked up in the query language of each host: no separator, quote or escape may reach it, and no space at the ends.
const CARD_LABEL = '^[^\\s,"\\\\\\u0000-\\u001f](?:[^,"\\\\\\u0000-\\u001f]*[^\\s,"\\\\\\u0000-\\u001f])?$';

const string = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, maxLength: 4000, pattern: NO_NUL, ...extra });
const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description, maxLength: 4000, pattern: NO_NUL });
const boolean = (description: string): JsonSchema => ({ type: 'boolean', description });
const integer = (description: string, minimum?: number, maximum?: number): JsonSchema => ({ type: 'integer', description, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
const enumOf = (description: string, values: readonly string[]): JsonSchema => ({ type: 'string', description, enum: [...values] });
const list = (description: string, items: JsonSchema, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'array', description, items, ...extra });
const strings = (description: string): JsonSchema => list(description, { type: 'string', maxLength: 4000, pattern: NO_NUL }, { maxItems: 200 });

function object(description: string, properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: 'object', description, properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function byRole(description: string, item: JsonSchema): JsonSchema {
  return object(description, Object.fromEntries(LLM_ROLES.map((r) => [r, item])), [...LLM_ROLES]);
}

/** One model of a pool: a provider the person registered, a model id, and what is known about it. */
const modelRef = object(
  'A model of a registered provider.',
  {
    provider: string('A provider id (llm.providers).', { pattern: ID }),
    model: string('Model id as the provider spells it.', { minLength: 1, maxLength: 200, pattern: '^\\S+$' }),
    images: boolean('The model takes an image in a message. Absent: the provider\'s capability decides.'),
    contextWindow: integer('Context window in tokens, when known.', 1000, 10_000_000),
    echoReasoning: boolean('Send the model\'s own reasoning back to it from the first call (some reasoning models need it). Absent: learned at run time.'),
  },
  ['provider', 'model'],
);

const modelList = (description: string): JsonSchema => list(description, modelRef, { maxItems: MAX_POOL_ENTRIES });

const poolFields = {
  fallbacks: modelList('Spare models, cheapest first: the call moves to the next one when the model in use is busy. Absent: none, nothing changes.'),
  activities: object(
    'A complete list per activity, replacing the role\'s list for it. An activity without a list uses the role\'s.',
    Object.fromEntries(ACTIVITIES.map((a) => [a, modelList(`The models for the "${a}" activity, in order.`)])),
  ),
};

const score = (description: string): JsonSchema => ({ type: 'number', description, minimum: 0, maximum: 100 });
const scoresOf = (description: string): JsonSchema => object(description, Object.fromEntries(SCORED_ACTIVITIES.map((a) => [a, score(`Score for "${a}", 0 to 100.`)])));

const provider = object(
  'A model provider.',
  {
    id: string('Stable id, referenced by llm.roles.', { pattern: ID }),
    kind: enumOf('How the provider is reached: anthropic, bedrock, vertex, foundry (Claude) or openai-compatible.', PROVIDER_KINDS),
    engine: enumOf("Agent loop that serves the provider: claude-sdk (Claude models) or open (the app's own loop).", ENGINES),
    baseUrl: string('API root, e.g. https://api.anthropic.com or http://localhost:11434/v1. Cloud kinds may leave it empty.'),
    models: strings('Model ids the provider offers (suggestions; any id may still be typed).'),
    secretRef: nullableString("Reference into the secrets store (API key). null: no key is sent (local server, or the machine's own cloud credentials)."),
    envFile: nullableString('Claude-settings-style JSON file whose "env" block (minus KEY/TOKEN variables) joins the agent environment.'),
    options: { type: 'object', description: 'Kind-specific, non-secret settings (bedrock: region, profile; vertex: project, region; foundry: resource).', additionalProperties: { type: 'string', maxLength: 400 } },
    capabilities: {
      ...object(
        'Result of the connection test of an open-engine provider; null when never tested.',
        {
          chat: boolean('A plain completion works.'),
          tools: boolean('Tool calls work.'),
          jsonSchema: boolean('response_format json_schema works.'),
          streaming: boolean('Server-sent events work.'),
          reasoning: boolean('The model returns its reasoning separately.'),
          contextWindow: { type: ['integer', 'null'], description: 'Context window in tokens, when the server reports it.', minimum: 256 },
          images: boolean('The model takes an image in a message; absent when not known.'),
        },
        ['chat', 'tools', 'jsonSchema'],
      ),
      type: ['object', 'null'],
    },
    structured: enumOf('How the JSON answer is obtained (open engine).', STRUCTURED_MODES),
    headers: { type: 'object', description: 'Extra headers some gateways want (open engine). Never put a key here.', additionalProperties: { type: 'string', maxLength: 400 } },
    maxOutputTokens: { type: ['integer', 'null'], description: "Cap on one call's output (open engine); null: the server's default.", minimum: 1 },
    temperature: { type: ['number', 'null'], description: "Sampling temperature (open engine); null: the server's default.", minimum: 0, maximum: 2 },
    timeoutMs: { type: ['integer', 'null'], description: "Limit of one whole call in ms (open engine); null: the engine's default.", minimum: 1000 },
    legacyCustomEndpoint: boolean('The Claude Agent SDK is pointed at a non-Anthropic endpoint; kept only for installs that predate the configuration.'),
  },
  ['id', 'kind'],
);

const repo = object(
  'A repository the ceremonies look at.',
  {
    id: string('Short name used in cards and prompts.', { pattern: ID }),
    path: string('Local checkout ("~/" expands).', { minLength: 1 }),
    remoteUrl: nullableString('Remote URL.'),
    vcsId: nullableString('A vcs integration id.'),
    projectPath: nullableString('"group/name" on the host when it cannot be derived from remoteUrl.'),
  },
  ['id', 'path'],
);

const vcs = object(
  'A version control or issue tracker integration.',
  {
    id: string('Stable id, referenced by projects.', { pattern: ID }),
    kind: enumOf('Provider.', VCS_KINDS),
    host: string('Host without scheme.', { minLength: 1 }),
    apiUrl: string('API root; empty: derived from host and kind.'),
    user: string('Login the integration acts as.'),
    secretRef: nullableString('Reference into the secrets store for an API token. null: rely on the CLI login.'),
    cliPreference: enumOf('auto: CLI when installed, API otherwise.', CLI_PREFERENCES),
    cliCommand: nullableString('Executable of the provider CLI; null: the default for the kind.'),
  },
  ['id', 'kind', 'host'],
);

const fileList = (description: string): JsonSchema => list(description, string('File name.', { pattern: ARTIFACT, maxLength: 100 }), { maxItems: 20, uniqueItems: true });

const waitFor = object(
  'What a wait stage waits for.',
  {
    kind: enumOf('pr-merged: the pull request of the run is merged. reporter-reply: a person comments on the issue. label: the issue carries a label. linked-done: every run this one asked another squad for has ended, or its issue was closed. time: some minutes pass. release-approved: every pull request of the release is merged into its branch. beta-age: the latest beta has been published for some minutes and nothing blocks it. beta-out: the latest beta is on the host (its tag on the remote, its pre-release published). stable-out: the stable tag is on the remote, on main.', WAIT_KINDS),
    label: string('For label: the label name.', { maxLength: 200 }),
    minutes: integer('For time: minutes after the stage is entered.', 1, 525_600),
  },
  ['kind'],
);

const stage = object(
  'A stage of the flow an issue goes through.',
  {
    id: string('Stable id.', { pattern: ID }),
    label: string('Name shown on the cards.'),
    match: strings('Case-insensitive regular expressions tested against the card stage or issue status.'),
    kind: enumOf('What the stage means.', STAGE_KINDS),
    rank: integer('Position in the flow: higher is closer to done.', 0, 100),
    type: enumOf('Flow cycles only. work: an agent produces something; gate: the person decides; wait: the run waits for an event.', STAGE_TYPES),
    agentId: string('The agent of agents.team that works this stage in a run; it wins over the stages list of the agents.', { pattern: ID }),
    produces: fileList('Files, in the cycle folder, that this stage must produce: plain names, none starting with a dot.'),
    reads: fileList('Artifacts the stage is given; left out: every earlier one.'),
    next: { type: ['string', 'null'], description: 'The stage that follows; left out: the next in the list; null: the run ends after this stage.', pattern: ID },
    returnsTo: string('Where the work goes back to (a rejected gate, a review with blocking findings, a QA failure); left out: the work stage nearest before.', { pattern: ID }),
    roundLimit: integer('How many returns this stage may cause before the run asks the person; left out: 2.', 1, 20),
    waitsFor: waitFor,
    comment: { type: ['string', 'null'], description: 'The key of this stage\'s comment template in devCycle.comments; left out: the stage id; null or empty: no comment.', maxLength: 48 },
    trackerStatus: string('A label the issue gets on the tracker when the run enters the stage.', { maxLength: 200 }),
    poolMode: enumOf('How the pool of the stage\'s agent is used here (work stages): fallback: one model, the pool only when it is busy; switch: each turn goes to the model of its activity; delegate: a fixed main model hands edit, command and screen work to sub-agents. Left out: the workspace\'s llm.poolMode.', POOL_MODES),
    testEnv: boolean('This stage receives the workspace\'s test environment (plain variables and secret references from testEnvironment). Left out: a QA stage of the current editor reads as yes, an already-saved template reads as no.'),
  },
  ['id', 'kind'],
);

const commentTemplate = object(
  'What a comment the runner leaves on the tracker looks like.',
  {
    title: string('What the comment is called where the app lists it (a catalog key or a literal).', { minLength: 1, maxLength: 200 }),
    status: string('The first line of the comment; it may use {stage}, {round}, {result}, {decision} and {ref} (a catalog key or a literal).', { minLength: 1, maxLength: 400 }),
    sections: list('The sections after the status, in order; one with nothing to say is left out.', object('One section.', { heading: string('Its heading (a catalog key or a literal).', { minLength: 1, maxLength: 200 }), guidance: string('What it must say, as the agent is told (a catalog key or a literal).', { maxLength: 2000 }) }, ['heading']), { maxItems: 20 }),
    technicalDetail: boolean('Ends the comment with a collapsed technical section: file, function and line names go only there.'),
  },
  ['title', 'status'],
);

const phaseFile = object('A document whose presence says where an issue is.', { file: string('Base name of the document.', { minLength: 1 }), label: string('Phase text shown on the card.') }, ['file']);

const quickTransition = object(
  'One status change the quick actions offer.',
  {
    to: string('Name of the status the issue moves to.', { minLength: 1 }),
    id: { type: 'integer', description: 'Id of that status on the GitLab instance.', minimum: 0 },
    label: string('The stage label the issue gets.', { minLength: 1 }),
    from: strings('Statuses the issue may leave.'),
    removable: strings('Stage labels removed on the way.'),
  },
  ['to', 'id', 'label', 'from', 'removable'],
);

/** The five choices of autonomy, all off by default; the four below `cycle` only count while it is on. */
const autonomy = object('What a run lets go on without the person.', {
  cycle: boolean('Every stage starts when the run reaches it and hands its result on without waiting, whatever each agent\'s own autonomy is.'),
  hostCommands: boolean('The commands of an agent set to `shell: host` run without the "Allow" question. Only meaningful while cycle is on.'),
  gates: boolean('A gate of the flow is approved by the app, recorded as an automatic approval with its reason. Only meaningful while cycle is on.'),
  push: boolean('The run\'s push goes through the door of Actions by itself, audited; steps that always wait for the person are not reached. Only meaningful while cycle is on.'),
  pullRequest: boolean('The pull request is opened by itself, audited; a step that always waits for the person is not reached. Only meaningful while cycle is on.'),
});

/** A flow's autonomy block, the workspace's block deciding while `useWorkspace` is on (the default). */
const flowAutonomy = object(
  'The autonomy block of one flow: the workspace\'s decides while useWorkspace is on.',
  { useWorkspace: boolean('On: the workspace\'s block decides for this flow and the fields here are shown disabled. Off: this block decides.'), ...autonomy.properties } as Record<string, JsonSchema>,
);

/** The workspace's block: a flow's five fields and the board's own choice, which is not a step of a run and so does not depend on `cycle`. */
const workspaceAutonomy = object(
  'What a run lets go on without the person, and whether the board writes to the code host by itself.',
  { ...autonomy.properties, board: boolean('A write of the board (a card sent to the code host, moved, commented, closed) goes through the door executed and audited, with no "yes" in Actions. Independent of cycle; a test workspace still refuses it.') } as Record<string, JsonSchema>,
);

const gateFiles = object(
  'Where the artifact of a gate lives.',
  {
    sub: string('Sub-folder of the spec folder.'),
    gate: { type: 'integer', description: 'Gate number.', enum: [1, 2] },
    files: list('[file, label] pairs in order of preference.', { type: 'array', items: { type: 'string', maxLength: 400 }, minItems: 2, maxItems: 2 }),
  },
  ['sub', 'gate', 'files'],
);

const agentRole = object(
  'Settings of one agent role.',
  {
    modelRole: enumOf('The llm.roles entry this agent role calls.', LLM_ROLES),
    extraInstructions: string('Text appended to the system prompt.', { maxLength: 20_000 }),
    promptOverride: string('Replaces the built-in role preamble when not empty.', { maxLength: 20_000 }),
    persona: string('Persona or tone of this agent, appended after the shared one.', { maxLength: 2000 }),
    maxTurns: { type: ['integer', 'null'], description: 'Turn limit of every call of this role; null: each call keeps its own limit.', minimum: 1, maximum: 200 },
    docs: object('Which documentation sources of docs this role may read.', {
      claudeMd: boolean('CLAUDE.md files.'),
      skills: boolean('Skills folders.'),
      rules: boolean('Rules folders.'),
      agents: boolean('Agents folders.'),
      knowledge: boolean('Knowledge base folders.'),
      mcp: boolean('MCP config files.'),
    }),
  },
);

const agentModel = object('Which model an agent uses.', {
  role: { type: ['string', 'null'], description: 'Borrow the provider and model of this llm.roles entry; null: use provider and model.', enum: [...LLM_ROLES, null] },
  provider: string('A provider id; empty while role is set.', { pattern: PROVIDER_OR_EMPTY }),
  model: string('Model id as the provider spells it; empty while role is set.', { maxLength: 200, pattern: '^\\S*$' }),
  ...poolFields,
  images: boolean('The agent\'s own model takes an image in a message.'),
  contextWindow: integer('Context window of the agent\'s own model, in tokens, when known.', 1000, 10_000_000),
  echoReasoning: boolean('Send the agent\'s own model its reasoning back from the first call.'),
});

/** The tools pre-approved for agents, at the workspace and (overriding it field by field) per agent. */
const agentTools = object('Tools pre-approved for agents. Writes, web and secret files are always blocked.', {
  files: boolean('Read, Grep and Glob.'),
  skills: boolean('Claude Code skills.'),
  trackerMcp: boolean('Issue tracker MCP tools.'),
  trackerMcpServer: string('MCP server that offers the issue tools; empty: none.', { maxLength: 100 }),
  vcsCli: boolean('Read-only use of the VCS CLI.'),
  subagents: boolean('Subagents in the unblock ceremony.'),
});

const agentDef = object(
  'A member of the agent team.',
  {
    id: string('Lowercase letters, digits, "-" and "_"; also the name an @mention uses.', { pattern: ID }),
    name: string('Name shown to the person (a catalog key or a literal).', { minLength: 1, maxLength: 80 }),
    job: string('What the agent does (a catalog key or a literal).', { maxLength: 2000 }),
    model: agentModel,
    stages: list('Ids of the devCycle.stages the agent works.', string('A stage id.', { pattern: ID }), { maxItems: 60, uniqueItems: true }),
    permission: enumOf('read: only reads; worktree: also changes files inside the worktree of its run, nowhere else.', AGENT_PERMISSIONS),
    tracker: enumOf('none: no code host reads in a run; read: reads issues, comments and pull requests (never a write). Absent: none.', AGENT_TRACKERS),
    shell: enumOf('none: no commands; allowlist: the commands of runner.commands exactly as written (agents that write only); sandbox: any command inside a sandbox built for the stage; host: any command on this computer, unsandboxed. Absent: allowlist for an agent that writes, else none.', AGENT_SHELLS),
    allowedCommands: list('Commands the person allowed this agent always in a ceremony: "prefix:*" allows the prefix and anything after a space, anything else only that exact command. Never a command that writes to the code host.', string('A rule.', { minLength: 1, maxLength: 200 }), { maxItems: 200, uniqueItems: true }),
    tools: { ...agentTools, description: 'The tools this agent may use, overriding the workspace\'s agents.tools field by field (an agent may use one the workspace turned off). Absent: the workspace\'s tools.' },
    autonomous: boolean('Runs by itself: its stage starts on its own, its tracker comments are posted automatically and its result goes on without waiting. Off: the person starts the stage, approves its comments in Actions and accepts its result. The ceremonies ignore it; pushing and opening the pull request always wait for the person.'),
    turnsTo: { type: ['string', 'null'], description: 'Who the agent turns to when it cannot decide: another agent of the team, or null for the person.', pattern: ID },
    squad: { type: ['string', 'null'], description: 'The squad the agent belongs to (a squads id); absent or null: a shared agent, which works for every squad.', pattern: ID },
    draft: boolean('An agent the AI assistant saved to be tested in a direct conversation: it works no stage, is not asked and is not called by another agent. Absent: an agent of the team.'),
    screen: boolean('A virtual screen for the agent and the app\'s browser tools, which the person can watch. Absent: off. A paired browser may turn it off, never on; a template or an import never brings it.'),
    allowedHosts: list('The hosts the agent may reach through the app\'s filtering proxy: exact lowercase names, HTTPS port 443, no wildcard or port. Not used by an agent on shell: host. Absent: none.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
    browserProfile: boolean('The agent\'s browser keeps its logins between uses, in a profile folder of its own in the workspace\'s data. Absent: off, a fresh profile every time.'),
    poolMode: enumOf('How the agent\'s model pool is used (fallback, switch or delegate). Absent: the stage\'s, then the workspace\'s llm.poolMode.', POOL_MODES),
    instructions: string('Appended to the agent system prompt (a catalog key or a literal).', { maxLength: 20_000 }),
    system: boolean('One of the five built-in agents: it can be edited and never removed.'),
  },
  ['id', 'name'],
);

const squadPath = object(
  'A folder of a repository.',
  {
    repo: string('A projects.repos id.', { pattern: ID }),
    prefix: string('The folder, relative to the repository root ("services/billing").', { minLength: 1, maxLength: 300 }),
  },
  ['repo', 'prefix'],
);

const squadScope = object('Which work is the squad\'s.', {
  repos: list('Repositories of the workspace (projects.repos ids) the squad owns.', string('A repository id.', { pattern: ID }), { maxItems: 50, uniqueItems: true }),
  labels: list('Issue labels the squad takes (case does not matter).', string('A label.', { minLength: 1, maxLength: 200 }), { maxItems: 50, uniqueItems: true }),
  paths: list('Folders of a repository the squad owns: an issue that mentions a file under one is the squad\'s.', squadPath, { maxItems: 100 }),
  unclaimed: boolean('The squad takes the issues no scope claims.'),
});

const squad = object(
  'A squad: agents with a scope, a flow and a liaison of their own.',
  {
    id: string('Lowercase letters, digits, "-" and "_".', { pattern: ID }),
    name: string('Name shown to the person (a catalog key or a literal).', { minLength: 1, maxLength: 80 }),
    mission: string('What the squad is for, in a sentence the agents read.', { maxLength: 2000 }),
    scope: squadScope,
    liaison: { type: ['string', 'null'], description: 'The member that speaks for the squad to the other squads: questions and requests from them arrive to it, and its members\' questions about another squad leave through it.', pattern: ID },
    autonomy: boolean('A squad-wide switch: off makes every member wait for the person (each agent\'s own switch applies when it is on).'),
    label: nullableString('A label the issue gets on the tracker when a run starts in the squad; null: none.'),
  },
  ['id', 'name'],
);

const stageRule = object(
  'Maps what a provider reports to a stage.',
  {
    provider: enumOf('Provider kind the rule is for; "any" applies to all.', [...VCS_KINDS, 'any']),
    source: enumOf('Where the provider carries the stage: label, status, field (board field), state or column.', STAGE_SOURCES),
    name: string('For source "field": the field name (e.g. "Status").'),
    pattern: string('Case-insensitive regular expression tested against the value.', { minLength: 1, maxLength: 400 }),
    stage: string('The id of the stage it maps to.', { pattern: ID }),
  },
  ['provider', 'source', 'pattern', 'stage'],
);

const words = (description: string): JsonSchema => integer(description, 5, 1000);
const text = (description: string): JsonSchema => string(description, { maxLength: 4000 });

const ceremonyParams = object('Parameters of each ceremony. A text is a catalog key or a literal in the language of the team.', {
  preDaily: object('The daily preparation.', {
    label: text('How the team calls it.'),
    speechWords: words('Words of the spoken turn of each agent.'),
    specReads: integer('Reads of the spec an agent may do while preparing; 0 tells it not to read.', 0, 20),
    summaryTarget: text('Where the summary is pasted; empty: a generic team chat.'),
    summaryStyle: text('How the summary is written.'),
  }),
  unblock: object('The unblock conversation.', { speechWords: words('Words of a spoken answer.') }),
  gate: object('The gate quiz.', {
    maxQuestions: integer('Most questions of one round.', 1, 10),
    questionKinds: list('Kinds of consequence question.', { type: 'string', maxLength: 200, pattern: NO_NUL }, { maxItems: 20 }),
    summaryWords: words('Words of the gate summary.'),
  }),
  qaHandoff: object('The QA hand-off.', { speechWords: words('Words of the spoken hand-off.') }),
  retro: object('The retrospective.', { windowDays: integer('Days it looks back over.', 1, 90), speechWords: words('Words of the opening.') }),
  releaseConflicts: object('Release sync and conflict resolution.', { speechWords: words('Words of a spoken answer.') }),
});

const meanings = object('What the team means by the words the agents use.', {
  blocker: object('A blocker.', {
    stageKinds: list('A card in a stage of one of these kinds counts as blocked.', enumOf('Stage kind.', STAGE_KINDS), { maxItems: 20, uniqueItems: true }),
    text: text('What a blocker is, handed to the agent; empty: nothing is said.'),
  }),
  question: object('A question for the user.', { enabled: boolean('Agents may end their turn with a question.'), text: text('What the agent may ask about.') }),
  readyForQa: object('Ready for QA.', {
    stageKinds: list('A card in a stage of one of these kinds is ready for the QA hand-off.', enumOf('Stage kind.', STAGE_KINDS), { maxItems: 20, uniqueItems: true }),
    requiresSpec: boolean('Only a card with a spec folder can be handed to QA.'),
    text: text('What ready for QA means; empty: nothing is said.'),
  }),
});

const promptOverride = {
  type: 'object',
  description: 'The text that replaces a prompt, per language.',
  properties: { 'pt-BR': string('Portuguese text.', { maxLength: 20_000 }), en: string('English text.', { maxLength: 20_000 }) },
  additionalProperties: false,
} as JsonSchema;

const command = { enabled: boolean('The integration is on.'), command: string('Executable ("~/" expands); never run through a shell.') };

const pluginAllow = object(
  'What the person allowed the plugin "always": kept until taken back, and kept when the plugin is switched off and on.',
  {
    network: boolean('The plugin may reach the destinations it declared.'),
    write: boolean('The plugin\'s declared external write may go out; an irreversible one is still announced with a deadline first.'),
  },
  ['network', 'write'],
);

const plugin = object(
  'A plugin of the workspace and what the person decided about it; everything else is read again from its folder.',
  {
    id: string('Stable identity the plugin announces.', { pattern: ID }),
    folder: nullableString('Folder of the plugin as it was last read; null: listed but not read.'),
    enabled: boolean('The person switched it on. Off: nothing of it is offered and no hook of it runs.'),
    allow: pluginAllow,
    allowedFor: string('A digest of what the plugin declared it reaches when it was allowed always; another declaration asks again.', { maxLength: 64 }),
    settings: { type: 'object', description: 'The values of the plugin\'s text and url settings, by key; a secret setting is never here.', additionalProperties: { type: 'string', maxLength: 2000 }, maxProperties: 40 } as JsonSchema,
  },
  ['id', 'enabled', 'allow'],
);

const plugins = object(
  'The plugins of the workspace: the team\'s own code, read from a folder. Nothing is downloaded or installed.',
  {
    dir: nullableString('Folder that holds one folder per plugin ("~/" expands); null: the plugins folder of the workspace data folder.'),
    list: list('What the person decided about each plugin, by identity.', plugin, { maxItems: 100 }),
    confirmSeconds: integer('Seconds an allowed irreversible write is announced before it goes out; the person may block it or take the permission back meanwhile.', 5, 3600),
  },
  ['list', 'confirmSeconds'],
);

export const CONFIG_SCHEMA: JsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:coxia:schema:workspace-config:6',
  title: 'Coxia workspace configuration',
  ...object(
    'Everything a workspace decides. Secrets never appear here, only references (secretRef).',
    {
      schemaVersion: { type: 'integer', description: 'Version of this document.', const: CONFIG_SCHEMA_VERSION },
      setupComplete: boolean('The setup wizard finished (or the config came from an existing install).'),
      language: enumOf('Interface and agent language.', LANGUAGES),
      userName: string('How the agents address the user; empty: no name.', { maxLength: 80 }),
      userArticle: enumOf('Portuguese article that goes with the name ("o Bruno", "a Ana"); empty: the name alone.', USER_ARTICLES),
      appearance: object('Look.', { theme: enumOf('Color theme.', THEMES) }),
      notifications: boolean('Desktop and push notifications.'),
      closeToTray: boolean('Closing the window keeps the app in the tray.'),
      retention: object('Local history retention.', { enabled: boolean('Delete history older than days.'), days: integer('Days to keep.', 7, 365) }),
      attachments: object('Files a person may attach to a message of the forum. The kind is decided by the content, never by the file name.', {
        enabled: boolean('The message box takes files.'),
        limits: object('Size per file, per message and how many files a message takes.', {
          imageBytes: integer('Largest image (bytes).', 1024, 50 * 1024 * 1024),
          otherBytes: integer('Largest file of any other kind (bytes).', 1024, 50 * 1024 * 1024),
          messageBytes: integer('Largest total of one message (bytes).', 1024, 100 * 1024 * 1024),
          perMessage: integer('At most how many files one message takes.', 1, 50),
        }),
        agents: boolean('A called agent receives the files of the message it was called in. Off: the person still attaches and opens them, and the agent is told why it does not.'),
      }),
      schedule: object('When the app reminds and checks.', {
        preDaily: string('HH:MM of the pre-daily reminder.', { pattern: TIME }),
        days: list('Weekdays (0 = Sunday) the schedule runs.', integer('Weekday.', 0, 6), { maxItems: 7, uniqueItems: true }),
        statusEveryMin: integer('Minutes between status checks.', 5, 240),
        from: string('HH:MM the work day starts.', { pattern: TIME }),
        to: string('HH:MM the work day ends.', { pattern: TIME }),
        retroDay: integer('Weekday of the retro reminder.', 0, 6),
        retroTime: string('HH:MM of the retro reminder.', { pattern: TIME }),
      }),
      llm: object('Model providers and which one serves each role.', {
        providers: list('Providers.', provider, { maxItems: 20 }),
        roles: byRole('Provider and model per role.', object('Provider and model.', { provider: string('A provider id.', { pattern: ID }), model: string('Model id as the provider spells it.', { minLength: 1, maxLength: 200, pattern: '^\\S+$' }), images: modelRef.properties!.images, contextWindow: modelRef.properties!.contextWindow, echoReasoning: modelRef.properties!.echoReasoning, ...poolFields }, ['provider', 'model'])),
        poolMode: enumOf('The default for how a pool is used. fallback: one model, the pool only when it is busy. switch: each turn goes to the model of its activity\'s list. delegate: the main model stays fixed and hands edit, command and screen work to sub-agents on the lists of their activity. It acts only where a role or an agent has a list of its own for an activity. Absent: delegate.', POOL_MODES),
        scoreOverrides: object('Overrides of the quality scores the app ships for the suggested pools.', {
          floors: scoresOf('The score a model must reach to go first, per activity.'),
          models: { type: 'object', description: 'The scores of one model, by its normalized id (lowercase, without the organization prefix).', additionalProperties: scoresOf('Scores of the model.') },
        }),
      }),
      projects: object('Where the code lives.', {
        roots: strings('Folders that contain the repos; the first is the working directory of the agents.'),
        repos: list('Repositories listed explicitly.', repo, { maxItems: 200 }),
        autoDiscover: boolean('Also treat git repos directly under the roots as projects.'),
        issues: object('The project that holds the issues.', {
          vcsId: nullableString('A vcs integration id.'),
          project: nullableString('"group/name" of the issue project.'),
          projectId: { type: ['integer', 'null'], description: 'Numeric id of the issue project.' },
          refPrefix: string('Prefix of a card ref, e.g. "app#".', { maxLength: 40 }),
          cardScope: enumOf('Which open issues become cards: assigned (mine, the default), all (every open issue of the issue project) or labels (those of the issue project with any of cardLabels).', CARD_SCOPES),
          cardLabels: list('Labels of the "labels" scope: an issue with any of them is a card. No comma, quote, backslash or control character; at most 10.', { type: 'string', maxLength: 100, pattern: CARD_LABEL }, { maxItems: 10 }),
        }),
        verifyCommands: { type: 'object', description: 'Shell command (bash -lc, in the conflict worktree) that checks a conflict resolution, by project "group/name". A blank command means none.', additionalProperties: { type: 'string', maxLength: VERIFY_COMMAND_MAX, pattern: NO_NUL } },
      }),
      vcs: list('Integrations with a git host.', vcs, { maxItems: 20 }),
      docs: object('Where the agents find their context (Claude Code layout).', {
        autoDetect: boolean('For the ceremonies, add ~/.claude, <project>/.claude and CLAUDE.md when present; for every agent, add the .mcp.json of each project. The agents of runs, mentions and conversations read the root AGENTS.md of each repository, not the Claude Code files.'),
        claudeMdRoots: strings('Folders whose CLAUDE.md is part of the context.'),
        skillsDirs: strings('Skills folders.'),
        rulesDirs: strings('Rules folders.'),
        agentsDirs: strings('Agents folders.'),
        knowledgeDirs: strings('Knowledge base folders.'),
        mcpConfigFiles: strings('MCP config files.'),
        specsDir: nullableString('Folder with one subfolder per issue. null: no spec files.'),
      }),
      devCycle: object('The development cycle the ceremonies follow.', {
        templateId: string('Template this section came from.', { pattern: '^[a-z0-9][a-z0-9_.-]{0,47}$' }),
        ceremonies: object('Which ceremonies are on.', Object.fromEntries(CEREMONY_IDS.map((c) => [c, boolean(`The ${c} ceremony is on.`)])), [...CEREMONY_IDS]),
        ceremonyParams,
        stages: list('Stages of the flow and how to recognise them.', stage, { maxItems: 60 }),
        flows: { type: 'object', description: 'The flow of a squad that has one of its own, by squad id: the stages its runs follow. A squad with no entry follows stages. The keys release and docs are no squad\'s: they hold the flow of a release run and the flow of a documentation run.', additionalProperties: list('Stages of the squad\'s flow.', stage, { maxItems: 60 }) },
        autonomy: { type: 'object', description: 'The autonomy block of each flow, by the flow\'s key: \'\' for the main flow, the id of a squad for its own, and "release" for the release flow. A flow with no entry follows the workspace\'s block.', additionalProperties: flowAutonomy },
        stageMapping: list('How a provider state or label maps to a stage; the first match wins.', stageRule, { maxItems: 300 }),
        meanings,
        enrichment: object('What the agent is given about each card.', {
          specFolder: boolean('Look the issue folder up in docs.specsDir and describe it on the card.'),
          cardFields: list('Fields of the card the agent sees.', enumOf('Card field.', CARD_FIELDS), { maxItems: 20, uniqueItems: true }),
          extraFiles: strings('Documents the card names when they exist (relative to the spec folder, or "./" for the projects root).'),
        }),
        priority: object('How the tracker priority reaches a card.', { labels: list('Labels that say how urgent an issue is, highest first; each is a case-insensitive regular expression. A priority is written back only to an entry that is a plain label name.', { type: 'string', minLength: 1, maxLength: 200, pattern: NO_NUL }, { maxItems: 20 }) }),
        prompts: object('Which prompt family each role uses.', Object.fromEntries(PROMPT_ROLES.map((r) => [r, string(`Prompt family of the ${r} prompts.`, { pattern: '^[a-z][a-z0-9-]{0,31}$' })]))),
        promptOverrides: { type: 'object', description: 'Replaces single prompt texts, by prompt id (e.g. "turn.main"), per language.', additionalProperties: promptOverride },
        pipelineSkill: string('Name of the skill that describes the team pipeline; empty: none.', { maxLength: 100 }),
        releaseLabelPattern: string('Regular expression for the label that says an issue shipped; group 1 is the version shown.', { maxLength: 200 }),
        specLayout: object('How an issue folder is laid out.', {
          folderPrefix: string('The spec folder starts with this; "{iid}" is the issue number.', { minLength: 1, maxLength: 100 }),
          phaseFiles: list('From the most advanced phase to the first.', phaseFile, { maxItems: 60 }),
          planFiles: strings('Files that hold the plan.'),
          gateFiles: list('Artifacts of each gate.', gateFiles, { maxItems: 30 }),
          decisionLog: object('Where the decisions of the ceremonies are recorded in the plan.', { heading: text('Heading text (catalog key or literal); empty: decisions stay in the minutes.') }),
          documents: object('Names of the documents the app writes.', { gateQuiz: string('Gate quiz record.', { minLength: 1 }), completion: string('Issue completion record.', { minLength: 1 }), qaChecklist: string('QA checklist.', { minLength: 1 }) }),
        }),
        comments: { type: 'object', description: 'The comments the runner leaves on the tracker, by stage id and by event (gate, question, pr). A stage with no entry posts nothing.', additionalProperties: commentTemplate },
        quickTransitions: list('Status changes the quick actions of a card offer on GitLab.', quickTransition, { maxItems: 20 }),
        qa: object('QA hand-off.', { user: nullableString('Login whose issue notes carry the release branch and pipelines.') }),
      }),
      agents: object('How the agents behave.', {
        tools: { ...agentTools, description: 'Tools pre-approved for every agent, unless the agent overrides them. Writes, web and secret files are always blocked.' },
        extraInstructions: string('Appended to every agent.', { maxLength: 20_000 }),
        persona: string('Persona or tone shared by every agent.', { maxLength: 2000 }),
        roles: byRole('Per agent role.', agentRole),
        team: list('The agent team: who works which stages of a run. The five built-in agents (one per LLM role) are always present.', agentDef, { maxItems: 40 }),
      }),
      squads: list('The squads of the workspace; empty: the workspace is one team.', squad, { maxItems: 20 }),
      voice: object('Speech.', {
        enabled: boolean('Voice is on; off turns calls into text conversations.'),
        engine: enumOf('Text-to-speech engine.', VOICE_ENGINES),
        sttModel: string('faster-whisper model name.', { minLength: 1, maxLength: 60 }),
        depsInstalled: boolean('The sidecar dependencies are installed on this machine.'),
        kokoroDir: nullableString('Folder with the Kokoro model files, outside the app data folder. null: only the app folders.'),
        autoStop: boolean('Send when the speaker stops.'),
        silenceMs: integer('Silence that ends an utterance (ms).', 500, 5000),
        speak: boolean('Agents speak aloud.'),
        prosody: boolean('Per-sentence intonation.'),
        bargeIn: boolean('Speaking interrupts the agent.'),
      }),
      claudeSdk: object('Where the Claude Agent SDK comes from.', {
        installed: boolean('The SDK was installed by the wizard, or is bundled with an install that predates the wizard.'),
        version: nullableString('Installed version, when known.'),
        path: nullableString('Folder of the user-local install; null: the bundled copy.'),
      }),
      externalTools: object('Optional tools the app calls. Each one is off until configured.', {
        cardSource: object('Command that lists the day\'s cards as JSON.', {
          ...command,
          reportArgs: strings('Arguments that print the cards.'),
          noteArgs: strings('Arguments that store a note; {ref} and {note} are replaced.'),
          stateFile: nullableString('File where the tool keeps its state.'),
          historyFile: nullableString('File where the tool appends one line per day it ran.'),
          timeoutMs: integer('Timeout of one run.', 1000, 900_000),
        }),
        releaseSync: object('Command that syncs branches with main after a release.', { ...command, cwd: nullableString('Working directory; null: the projects root.'), mirrorsDir: nullableString('Folder of the bare mirrors the tool keeps.') }),
        timeExport: object('Time tracking export.', { ...command, format: string('Layout the export command reads: "none" or the name of a layout.', { pattern: '^[a-z0-9][a-z0-9-]{0,31}$' }) }),
        terminal: object('Terminal used by "continue in Claude Code".', { command: nullableString('Emulator; null: gnome-terminal, then x-terminal-emulator.'), args: strings('Arguments before the shell command.') }),
        claudeCli: object('Claude CLI that resumes sessions.', { command: string('Executable.', { minLength: 1 }), cwd: nullableString('Starting directory; null: the projects root.') }),
      }),
      runner: object('What takes an issue through the agent cycle by itself.', {
        enabled: boolean('The app starts runs by itself for the issues that carry the trigger label. Starting a run by hand does not need it.'),
        triggerLabel: string('The issue label that asks for a run; case does not matter.', { maxLength: 100 }),
        maxConcurrentRuns: integer('How many runs the app starts by itself while others are still working; a run the person starts is never held back.', 1, 10),
        worktreesDir: nullableString('Where the runs\' worktrees are made ("~/" expands); null: the worktrees folder of the workspace data folder.'),
        commands: { type: ['array', 'null'], description: 'The only commands an agent that writes may run in its worktree, each one exactly as typed (one plain command: no pipe, ;, && or redirect). null: the test and typecheck scripts the repository declares. []: none.', items: string('One command.', { minLength: 1, maxLength: 300 }), maxItems: 20 },
        stageIdleMs: integer('An agent that shows no sign of life (no model event) for this long fails the stage, which can be retried (ms).', 10_000, 21_600_000),
        stageMaxMs: integer('A stage still going after this long fails whatever the agent shows; the cap on a stage that keeps talking and never finishes (ms).', 60_000, 86_400_000),
        turns: object('How many steps (model turns) an agent may take in one pass of a stage.', { read: integer('An agent that only reads and writes its documents.', 1, 500), write: integer('An agent that changes files.', 1, 500) }),
        autonomy: workspaceAutonomy,
        sandbox: object('What the sandbox of an agent set to `shell: sandbox` may reach and use.', {
          network: enumOf('off: no network at all; registry: only HTTPS (port 443) to registryHosts, through the app\'s filtering proxy; open: the computer\'s own network, shared whole, with no proxy and no host list (desktop only, a choice of risk). "Localhost" inside the sandbox is the sandbox\'s own except in open mode.', SANDBOX_NETWORKS),
          registryHosts: list('Exact host names the registry switch lets through.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
          readOnlyPaths: list('Folders outside the worktree every sandbox of the workspace may read, read-only ("~/" expands). Nothing that looks like a secret location is accepted.', string('A folder.', { minLength: 2, maxLength: 1000, pattern: NO_NUL }), { maxItems: 20 }),
          browsersPath: { type: ['string', 'null'], description: 'The folder Playwright keeps its browsers in ("~/" expands), bound read-only in every sandbox with PLAYWRIGHT_BROWSERS_PATH; the guards of readOnlyPaths apply. null: none.', minLength: 2, maxLength: 1000, pattern: NO_NUL },
          display: boolean('The sandbox of a QA stage starts a virtual display (Xvfb, from the sandbox\'s PATH) and sets DISPLAY.'),
          limits: object('What one command and one stage may use.', {
            commandMs: integer('Longest one command may run (ms).', 5_000, 3_600_000),
            stageMs: integer('Total command time of one stage (ms).', 60_000, 28_800_000),
            memoryMb: integer('Data memory of one process (MiB).', 512, 65_536),
            processes: integer('Processes inside the sandbox.', 16, 4096),
            fileMb: integer('Largest file one process may write (MiB).', 1, 8192),
            copyMb: integer('Largest tree an agent that only reads is given a copy of (MiB).', 64, 65_536),
          }),
        }),
        identity: object('Who the app\'s commits are made as (a run\'s, and the merge that resolves a conflict); both empty: the one in the repository\'s own .git/config, never the global one, and with neither the app does not commit.', { name: string('Author and committer name.', { maxLength: 200 }), email: string('Author and committer email.', { maxLength: 200 }) }),
        evidence: enumOf('Where a stage\'s evidence is kept: app (only with the run, in the workspace\'s data, never in a commit; the default) or cycle (also copied into the cycle folder and committed with the stage). Only the computer changes it. Optional: absent reads as app.', EVIDENCE_PLACEMENTS),
        procedures: boolean('Agents keep what they learned as procedures in the workspace and read them the next time. Only the computer changes it. Off: no tool and no prompt section; the Procedures view still lists, edits and deletes. Optional: absent reads as off.'),
        commitMessage: string('The commit message of the app\'s commits; {summary} and {iid} are replaced.', { minLength: 1, maxLength: 200 }),
        prTitle: string('The title of the pull request a run opens; {title} (the agent\'s title, or the issue\'s) and {iid} are replaced.', { minLength: 1, maxLength: 200 }),
        linkDependencies: boolean('A run\'s worktree gets a link to the dependency folders (node_modules, .venv) of the repository\'s clone, so the commands the app runs there find their tools. Optional: absent reads as true.'),
        release: object('How a release run integrates its pull requests.', {
          soleMaintainer: boolean('The person is the repository\'s only maintainer: their "yes" in Actions on a merge-pr stands for the host\'s approval of a pull request opened by the account the app uses on the host, with no changes asked; every merge-pr then waits for that "yes". Optional: absent reads as false.'),
        }),
        conversations: object('The limits of a conversation between team agents inside a run: how many messages a conversation accepts and how many one attempt at a stage may open. Optional: absent reads the defaults (6 and 3).', {
          roundsPerConversation: integer('How many messages of each side one conversation accepts before the app ends it.', 1, 50),
          perStage: integer('How many conversations one attempt at a stage may open.', 1, 20),
        }),
      }),
      plugins,
      testEnvironment: {
        type: 'object',
        description: 'What an allowed stage gets to exercise the app under development with: plain variables with their values, kept only here, and secret references into the secrets store under the test. prefix, whose values exist only on this computer, at launch.',
        properties: {
          variables: list('Plain variables (a URL, a feature flag, a model name). Never a credential: that is what the secrets are for.', object('One variable.', {
            name: string('The name it becomes as an environment variable of the stage.', { pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$', minLength: 1, maxLength: 64 }),
            value: string('The value, kept in this file only.', { maxLength: 4000 }),
            hosts: list('Exact host names the stage network opens to because of this entry (443, through the app proxy). Empty: it opens nothing.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
            privateHosts: list('Hosts of hosts that are private addresses, reached only when marked so here.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
          }, ['name', 'value']), { maxItems: 50 }),
          secrets: list('Secret references into the secrets store, every one under the "test." prefix. Never a value.', object('One secret.', {
            ref: string('The secrets-store reference.', { pattern: SECRET_REF }),
            testOnly: boolean('A secret for testing only (a dedicated project, a low-budget key). One not marked so needs the person confirmation, once, before a stage launches with it.'),
            hosts: list('Exact host names the stage network opens to because of this entry.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
            privateHosts: list('Hosts of hosts that are private addresses, reached only when marked so here.', string('A host name.', { minLength: 3, maxLength: 253, pattern: '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' }), { maxItems: 20 }),
          }, ['ref', 'testOnly']), { maxItems: 50 }),
        },
        required: ['variables', 'secrets'],
      },
      mcpState: object('The local read-only state server of the workspace: a terminal session adds it over stdio. It answers the workspace\'s cycles, runs, conversations, evidence and memories, always masked; it never writes.', {
        enabled: boolean('A terminal session with the setup entry may list the state server\'s read tools. Off: the server answers every call with the refusal.'),
      }),
    },
    ['schemaVersion'],
  ),
};
