import { LLM_ROLES, type DeepPartial, type LlmRole, type RoleModel, type StageDef, type WorkspaceConfig } from './types';

// The one place where the original author's company and machine live: what the app hardcoded before the configuration existed.
// It reaches a workspace only through the v1 migration (migrations.ts), so an existing install keeps working unchanged.
// A fresh install never sees any of this. Everything here has a field in WorkspaceConfig that replaces the hardcoded value.

export const LEGACY_PROVIDER_ID = 'openrouter';
export const LEGACY_SECRET_REF = 'llm.openrouter';
// Secret source of the OpenRouter key: the script the app used to run. Seeded into the secrets store of an existing install.
export const LEGACY_OPENROUTER_KEY_COMMAND = '~/.local/bin/openrouter-key';

export const LEGACY_MODEL_OPTIONS = ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro-0813', 'qwen/qwen3.7-flash'];
export const LEGACY_DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

export const LEGACY_REPOS = ['sz4', 'sz4-frontend', 'sz4-backend', 'new-agent', 'hub-whatsapp', 'agent-socket-manager', 'sz-playbook'];

// Browser access defaults of the old app (host of the docker bridge, the public tunnel). Written to web.json of an existing install when absent.
export const LEGACY_WEB_SETTINGS = {
  enabled: false,
  host: '172.18.0.1',
  port: 4330,
  basePath: '/cerimonias/',
  publicUrl: 'https://koala.fortics.dev/cerimonias/',
  trustedProxy: '172.18.0.0/16',
  allowExternalEffects: false,
};

export const LEGACY_STAGES: StageDef[] = [
  { id: 'test-ok', label: 'Test OK', match: ['Test OK', 'Approved in testing'], kind: 'qaApproved', rank: 7 },
  { id: 'in-testing', label: 'Ready To Test', match: ['Ready To Test', 'In Testing', 'Blocked in testing'], kind: 'qa', rank: 6 },
  { id: 'test-failed', label: 'Test Fail', match: ['Test Fail', 'Failed testing'], kind: 'returned', rank: 6 },
  { id: 'review-ok', label: 'Code Review OK', match: ['Code Review OK', 'Approved in code review'], kind: 'reviewApproved', rank: 5 },
  { id: 'in-review', label: 'Code Review', match: ['Code Review', 'Ready for code review', 'In code review'], kind: 'review', rank: 4 },
  { id: 'rejected', label: 'Rejected', match: ['Rejected'], kind: 'returned', rank: 3 },
  { id: 'doing', label: 'Doing', match: ['Doing', 'In development', 'Blocked in development'], kind: 'development', rank: 2 },
];

/** The company profile as a patch over the neutral defaults. Models come from the old settings (migrations.ts), not from here. */
export function legacyProfile(): DeepPartial<WorkspaceConfig> {
  return {
    setupComplete: true,
    language: 'pt-BR',
    llm: {
      roles: Object.fromEntries(LLM_ROLES.map((r) => [r, { provider: LEGACY_PROVIDER_ID, model: LEGACY_DEFAULT_MODEL }])) as Record<LlmRole, RoleModel>,
      providers: [
        {
          id: LEGACY_PROVIDER_ID,
          kind: 'anthropic',
          engine: 'claude-sdk',
          baseUrl: 'https://openrouter.ai/api',
          models: [...LEGACY_MODEL_OPTIONS],
          secretRef: LEGACY_SECRET_REF,
          envFile: '~/.claude/openrouter.settings.json',
          options: {},
          capabilities: null,
          structured: 'auto',
          headers: {},
          maxOutputTokens: null,
          temperature: null,
          timeoutMs: null,
          legacyCustomEndpoint: true,
        },
      ],
    },
    projects: {
      roots: ['~/projects'],
      repos: LEGACY_REPOS.map((id) => ({
        id,
        path: `~/projects/${id}`,
        remoteUrl: id === 'sz4' ? 'https://dark.smartzap.com.br/sz4/sz4.git' : null,
        vcsId: 'gitlab',
        projectPath: id === 'sz4' ? 'sz4/sz4' : null,
      })),
      autoDiscover: false,
      issues: { vcsId: 'gitlab', project: 'sz4/sz4', projectId: 1, refPrefix: 'sz4#' },
    },
    vcs: [{ id: 'gitlab', kind: 'gitlab', host: 'dark.smartzap.com.br', apiUrl: 'https://dark.smartzap.com.br/api/v4', user: '', secretRef: null, cliPreference: 'cli', cliCommand: 'glab' }],
    docs: {
      autoDetect: true,
      claudeMdRoots: ['~/projects', '~/projects/sz-playbook'],
      skillsDirs: ['~/projects/sz-playbook/.claude/skills'],
      rulesDirs: ['~/projects/sz-playbook/.claude/rules'],
      agentsDirs: ['~/projects/sz-playbook/.claude/agents'],
      knowledgeDirs: ['~/projects/sz-playbook/.claude/knowledge-base'],
      mcpConfigFiles: [],
      specsDir: '~/projects/sz-playbook/.specs',
    },
    devCycle: {
      templateId: 'sz-sdd',
      ceremonies: { preDaily: true, unblock: true, gate: true, qaHandoff: true, retro: true, releaseConflicts: true },
      stages: LEGACY_STAGES,
      releaseLabelPattern: '^sz4-(\\d+\\.\\d+\\.\\d+)$',
      specLayout: {
        folderPrefix: '#{iid}-',
        phaseFiles: [
          { file: 'ISSUE_COMPLETION.md', label: 'ISSUE_COMPLETION escrito' },
          { file: '3_TEST_PLAN.md', label: 'test plan escrito' },
          { file: '4_TEST_PLAN.md', label: 'test plan escrito' },
          { file: '2_PLAN.md', label: 'Plan escrito' },
          { file: '3_PLAN.md', label: 'Plan escrito' },
          { file: '2_SPEC_TECNICO.md', label: 'spec técnico escrito' },
          { file: '1_SPEC_FUNCIONAL.md', label: 'spec funcional escrito' },
          { file: '1_INVESTIGATION.md', label: 'investigação escrita' },
          { file: '1_FINDINGS.md', label: 'findings escritos' },
          { file: '0_RFC.md', label: 'RFC escrita' },
          { file: '0_BUG_REPORT.md', label: 'bug report escrito' },
        ],
        planFiles: ['2_PLAN.md', '3_PLAN.md'],
        gateFiles: [
          { sub: 'bug', gate: 1, files: [['1_INVESTIGATION.md', 'Investigation']] },
          { sub: 'bug', gate: 2, files: [['2_PLAN.md', 'Plan']] },
          { sub: 'feat', gate: 1, files: [['1_SPEC_FUNCIONAL.md', 'Spec Funcional'], ['0_RFC.md', 'RFC']] },
          { sub: 'feat', gate: 2, files: [['3_PLAN.md', 'Plan']] },
          { sub: 'investigation', gate: 1, files: [['1_FINDINGS.md', 'Findings']] },
        ],
        documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' },
      },
      qa: { user: 'qa.interno' },
    },
    agents: { tools: { trackerMcpServer: 'gitlab-issue-analysis' } },
    voice: { enabled: true, depsInstalled: true },
    claudeSdk: { installed: true, version: null, path: null },
    externalTools: {
      cardSource: {
        enabled: true,
        command: '~/.local/bin/daily-report',
        reportArgs: ['report', '--format', 'json', '--dry-run'],
        noteArgs: ['note', '{ref}', '{note}'],
        stateFile: '~/.local/share/daily-report/state.json',
        historyFile: '~/.local/share/daily-report/history.jsonl',
        timeoutMs: 150_000,
      },
      releaseSync: { enabled: true, command: '~/projects/sz-playbook/.claude/bin/post-release-sync', cwd: '~/projects/sz-playbook', mirrorsDir: '~/.cache/post-release-sync' },
      timeExport: { enabled: true, command: '~/.local/bin/clockify-log', format: 'clockify-log' },
      terminal: { command: 'gnome-terminal', args: ['--title', 'Coxia · Claude Code', '--'] },
      claudeCli: { command: 'claude-or', cwd: '~/projects' },
    },
  };
}
