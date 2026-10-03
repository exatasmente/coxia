# #23 Choose which issues become cards — technical plan

Scope: the whole of [`1_SPEC.md`](1_SPEC.md). Evidence is the code as of release 0.2.2.

## What gets built

| # | Piece | Where it lands |
|---|---|---|
| 1 | Config fields and the pure rule that decides what a stored choice really does | `src/shared/config/{types,schema,defaults,validate}.ts`, new `src/shared/cardScope.ts`, `VCS_CAPS.issueLabels` |
| 2 | One provider method that lists the open issues of a project, not only mine | `VcsProvider.listIssues` in `src/main/vcs/{types,github,gitlab,bitbucket}.ts` |
| 3 | The card source asks for the scope | `src/main/vcs/{cards,cardSource}.ts`, report cache key in `src/main/report.ts` |
| 4 | The control, the notes and the texts | `src/renderer/src/wizard/steps/IntegrationsStep.tsx`, `wizard.{pt-BR,en}.json` |
| 5 | Docs and changelog | `docs/configuration.md`, `docs/vcs-providers.md` (both languages), `CHANGELOG.md` |

## Config

```ts
export const CARD_SCOPES = ['assigned', 'all', 'labels'] as const;
export type CardScope = (typeof CARD_SCOPES)[number];

interface IssueProjectConfig {
  vcsId; project; projectId; refPrefix;             // as before
  /** Which open issues of the tracker become cards. */
  cardScope: CardScope;                              // default 'assigned'
  /** Labels of the `labels` scope: an issue with any of them is a card. */
  cardLabels: string[];                              // default []
}
```

The fields live in `projects.issues` because that block is already "the tracker the cards come from": the same wizard section edits it, `rc().issues` already hands it to the card source, and a second block would split one decision in two.

- **Schema** (`schema.ts`): `cardScope` is an enum of `CARD_SCOPES`; `cardLabels` is a list of at most 10 strings of 1 to 100 characters that do not start or end with a space and contain no comma, quote, backslash or control character. The comma, the quote and the backslash are what the three hosts' query syntaxes would otherwise have to escape (GitLab's `labels=` is comma-separated, GitHub's search quotes names, Bitbucket's `q=` is a filter language); refusing them at the door means the providers never build a query from an unsafe name. Ten is the number of reads the GitLab path may make (one per label).
- **Defaults** (`defaults.ts`): `cardScope: 'assigned'`, `cardLabels: []` in `neutralConfig()`. `withConfigDefaults` already merges key by key, so a file without the fields gets them.
- **Validation** (`validate.ts`, `semantic()`): no new error. Warnings, from `effectiveCardScope` (below), when the stored choice will fall back: no issue project, no labels in a `labels` scope, `labels` on a host with no issue labels. The same function feeds the wizard note, so the warning and the note cannot disagree. A duplicated label is a warning, like duplicated priority labels.

### The rule: `effectiveCardScope`

`src/shared/cardScope.ts`, pure:

```ts
effectiveCardScope({ scope, labels, project, kind }): { scope: CardScope; labels: string[]; fallback: null | 'noProject' | 'noLabels' | 'noLabelSupport' }
```

- `assigned` is always itself, `fallback: null`.
- `all` and `labels` with no `project` (null or blank) -> `assigned`, `noProject`.
- `labels` on a kind whose `VCS_CAPS[kind].issueLabels` is false (Bitbucket) -> `assigned`, `noLabelSupport`.
- `labels` with no non-blank label -> `assigned`, `noLabels`.
- otherwise the stored choice, with the labels trimmed and de-duplicated case-insensitively.

Order of the checks is the order above, so the note names the first thing to fix. The card source calls it with the project **after** the "own integration" test it already does (`cardSource.ts`: the issue project only counts when the primary integration is the one that holds the issues), so a project configured on another host never feeds a scope read.

`VCS_CAPS` gets `issueLabels: boolean` (GitHub and GitLab true, Bitbucket false). It stays plain data next to the other caps; `HostFacts` does not expose it (nothing on screen outside the wizard needs it).

### Migration: schema 3 -> 4 (decision D1)

`CONFIG_SCHEMA_VERSION` goes to 4 and `STEPS[3] = v3ToV4` is added in `src/shared/config/migrations.ts`:

- writes `projects.issues.cardScope = 'assigned'` and `cardLabels = []` when absent (a value already there is kept, so the step is idempotent) and sets `schemaVersion: 4`;
- leaves the rest of the document alone, and a document with no `projects` to the defaults;
- never reads the disk.

Why a bump although no stored value changes: the schema is strict (`additionalProperties: false`), so an app that does not know the two fields reads a file with them as invalid, repairs by resetting the whole `projects.issues` block in memory and could save it back, losing the issue project. The version refusal ("written by a newer app") is the project's established way to avoid that (v2 -> v3 did the same). The first draft of this plan had no bump; the maintainer session chose the refusal.

- A bad stored value is repaired by the existing `repair()`: the path `projects.issues.cardScope` exists in the neutral base, so just that field goes back to `assigned` (with a note), the rest of the block is kept. Tested.
- A v4 file hand-edited to drop the fields still opens as `assigned` (the defaults fill it).
- Tests: `test/card-scope.test.ts` (v3 gets the defaults and keeps its project, v2 ends at 4, idempotent, keeps a scope already set, a file with no projects), and every assertion of the schema version in the config tests now says 4 (the "newer app" ones say 5).
- The JSON Schema description of the file (`config:schema`) documents both fields; `test/config-schema.test.ts` (types, schema and defaults cannot drift) covers them.

## Provider API

New method on `VcsProvider`, next to `listMyIssues`, which stays untouched:

```ts
export interface IssueListOptions { project: string; scope: 'all' | 'labels'; labels?: string[]; limit?: number }
/** Open issues of one project, whoever they are assigned to; `labels` keeps those with any of the names. */
listIssues(opts: IssueListOptions): Promise<VcsIssue[]>;
```

A separate method, not a flag on `listMyIssues`, because the old one is "mine" by name and by contract (the probe's "your issues" sample and the wizard test use it); the new one has a required project, which makes "no project" unrepresentable at the call.

Common to the three: the limit defaults to 200 like `listMyIssues`, the caller passes 100, and the page budget is the existing one (`maxPages` 2 on GitHub and Bitbucket; `ceil(limit / 100)` on GitLab). Results come back newest update first.

### GitHub

`GET search/issues?q=is:issue is:open repo:<owner/repo> [label:"a","b"]&sort=updated&order=desc`, two pages of 100 at most.

- Why search and not `repos/<r>/issues?state=open`: that endpoint returns pull requests as issues, so on a repository with many open PRs the two-page budget would be spent on them and filtered out afterwards; `is:issue` leaves them out of the count. The code already filters with `!i.pull_request`, kept as a guard.
- "Any of these labels": a comma inside one `label:` qualifier is an OR in GitHub's search syntax (`label:"bug","wip"`); the `labels=` parameter of the issues endpoint is an AND, so it cannot express the requirement.
- Search has its own, lower rate limit and is eventually consistent (a just-created issue may take a moment to show). Cards are cached for five minutes and the existing 403/429 mapping (`rate_limited`) applies; recorded as a risk.
- Both transports (`gh api` and token) share `tr.pages`, so one implementation serves both.

### GitLab

`GET projects/<id>/issues?scope=all&state=opened&order_by=updated_at[&labels=<one>]`.

- `scope=all` is passed explicitly: the default scope of the endpoint is not "all".
- "Any of these labels": `labels=` is an AND, and the OR filter (`or[labels]`) exists only on paid tiers of the host, so it is not relied on. The provider makes one read per label (at most 10, three at a time with `pool`), merges the rows by issue number and sorts them by update time. A label that matches nothing is an empty list, not an error.
- The workflow status of the issues is read afterwards exactly as for `listMyIssues` (one GraphQL read per project, failure leaves it empty): the existing loop is extracted into one helper used by both methods.
- A numeric project id works as it does for `listMyIssues`.

### Bitbucket

`GET repositories/<ws>/<repo>/issues?q=(state="new" OR state="open" OR state="on hold")&sort=-updated_on`, two pages. A repository with the tracker off answers 404 and is an empty list, as in `listMyIssues`. `scope: 'labels'` throws `VcsError('unsupported')`: the tracker has no labels, and the card source never asks (it falls back first). The throw is there so a caller that skips `effectiveCardScope` fails loudly instead of showing every issue.

## Card source

- `CardSourceOptions` gains `scope?: CardScope` and `labels?: string[]` (optional, default `assigned`: every existing call and test is unchanged).
- `buildCardReport` computes `effectiveCardScope` and calls `listMyIssues` for `assigned` (the exact call as today: same arguments, same limit) or `listIssues` otherwise. Everything after that (merge request linking, stage, blockers, refs, state comparison) works on the `VcsIssue[]`, so nothing else branches on the scope. The card JSON gets no new field: the default scope's output is byte-identical and the prompt goldens do not move.
- `providerReport` (`cardSource.ts`) passes `issues.cardScope` and `issues.cardLabels`.
- **Linking cost:** the cap of 25 `linkedMrs` reads for issues with no MR in any text stays. With `all`, issues are not mine and a linked MR of someone else only informs the issue's stage; MR cards stay mine.
- **Refresh on change:** `report.ts` keeps a 5 minute cache that nothing invalidates when the configuration changes. The cache stores a key (the issue project, the integration, the scope, the labels and whether a card-source command is on) and `readReport` treats a cache or an in-flight run with another key as stale. This is what makes "saving the scope refreshes the cards" true without an event wiring across modules.
- **State file:** `vcs-cards.json` compares today with the day's baseline per ref; a card that appears because the scope widened has no baseline entry, so it has no "changes" (`diff` returns none), instead of a burst of fake changes.
- The wizard probe (`probe.ts`) keeps its "my issues" sample; it checks the credential, not the scope.

## Settings UI

The place is the integrations step of the wizard, in the "Where the issues live" block (`IntegrationsStep.tsx`), which Settings opens through "Open the wizard"; no other screen edits `projects.*`.

- A `select` "Which issues become cards": `assigned`, `all`, and `labels` (not offered when the issue integration is a Bitbucket one; if a stored `labels` is already there it is shown, with its note). Disabled while there is no issue integration, like the sibling fields.
- With `labels`: a text input "Labels" taking names separated by commas; it is parsed to the array (trimmed, empties dropped, duplicates removed case-insensitively) on every change, and an entry the schema refuses cannot be typed because the comma is the separator and quotes and backslashes are stripped as typed.
- A note under the control from `effectiveCardScope(...).fallback`: `noProject`, `noLabels`, `noLabelSupport` each have a sentence; and, independent of the fallback, one sentence when `externalTools.cardSource.enabled` ("a card source command is on: it decides the cards"). The note is a `Notice` like the others of the wizard.
- Strings: `wizard.vcs.issuesScope`, `...issuesScopeHint`, `...issuesScope.assigned|all|labels`, `...issuesLabels`, `...issuesLabelsHint`, `...issuesScopeNote.noProject|noLabels|noLabelSupport|external`, in `wizard.pt-BR.json` and `wizard.en.json` with the same placeholders. They say "the tracker", "issues" and "the issue project"; where a host word is needed they use `{vcsName}`. They contain none of another host's words (`test/host-terms-leak.test.ts` renders them on every host), and none of them is a key that existed on `main`, so `test/gitlab-catalogs-unchanged.test.ts` has nothing to compare. `test/wizard-i18n.test.ts` keeps the key usage and the catalogs honest; the dynamic `wizard.vcs.issuesScope.${scope}` family is added to its `FAMILIES` table, as that test requires.
- The renderer needs no new IPC: it already reads and writes the whole config through `config:get` / `config:save`.

## Tests (no network, no model)

| File | What it proves |
|---|---|
| `test/card-scope.test.ts` (new) | `effectiveCardScope` for every combination: each fallback and its precedence, label cleaning, `assigned` unaffected by labels |
| `test/config-schema.test.ts`, `config-migrations.test.ts` | defaults hold the two fields; a v3 file gets the defaults written by `v3ToV4`; an invalid scope or label is repaired to the default without touching `project`/`refPrefix`; labels with a comma or a quote are refused; the schema is 4 and `config-transfer` round-trips the fields |
| `test/vcs-github.test.ts` | exact search query for `all` and for `labels` (any-of syntax, `is:issue is:open repo:`), PRs left out, pagination bounded at two pages, the same through `gh` (CLI fake) |
| `test/vcs-gitlab.test.ts` | exact endpoints (`scope=all`, one read per label), merge by issue number, ordering, status attached, numeric project |
| `test/vcs-bitbucket.test.ts` | `all` query and the 404 of a repository without a tracker; `labels` throws `unsupported` |
| `test/vcs-cards.test.ts`, `cr-ref.test.ts` | default scope: the same call to `listMyIssues` and the same report; `all`/`labels` call `listIssues` with project and labels; each fallback calls `listMyIssues`; refs use the prefix for the issue project; MR cards unchanged |
| `test/cards-load.test.ts` | a long `all` list is cut at the call limit with `rest` and `total` intact |
| `test/vcs-wizard.test.ts` / a new renderer-free test | the pure helpers of the step: parsing the labels field, which options a host offers |
| existing golden and host tests | unchanged: `test/golden` untouched, `host-terms-leak`, `gitlab-catalogs-unchanged`, `wizard-i18n` |

## Risks

| Risk | Handling |
|---|---|
| `all` on a big tracker floods the day | existing caps: 100 issues from the source, 8 in the call, the rest in the "left out" list; the spec says so. Truncation at the source (more than 100 open issues) is silent today for `assigned` too; not changed here, noted in the docs |
| GitHub search rate limit / index lag | five minute cache; `rate_limited` mapping; documented |
| GitLab `labels` costs one read per label | at most 10 labels, three at a time |
| A stored `labels` that cannot work (Bitbucket, empty) looks broken | the fallback is visible: wizard note, validation warning |
| An older app reads the new fields as unknown | the schema bump makes it refuse the file (D1) |
| The cached report served after a scope change | cache key (above) |
| Label names with characters a query could misread | refused by the schema; providers still strip quotes and backslashes defensively |

## Decision log

| # | Decision | Why |
|---|---|---|
| D1 | Schema 3 -> 4 with a `v3ToV4` step that writes the defaults | a strict schema makes an older app repair and possibly re-save a reset `projects.issues`; the version refusal is the established protection (decided by the maintainer session; first draft had no bump) |
| D2 | Fields in `projects.issues` (`cardScope`, `cardLabels`), not a new section | one decision, one place, `rc().issues` already carries it |
| D3 | `all` and `labels` without an issue project fall back to `assigned`, with a note and a warning; the choice is kept | "all issues the host lists for me" has no meaning without a project (a user can see thousands); not blocking the save because the project may be set next |
| D4 | `labels` with no labels falls back to `assigned`, not to `all` | an empty filter must never widen the day to every issue |
| D5 | A new `listIssues`, `listMyIssues` untouched | the old one is "mine" by contract and used by the probe; a required project makes the invalid call unrepresentable |
| D6 | GitHub through search, not the issues endpoint | the endpoint mixes PRs into the page budget; search also gives "any of" labels |
| D7 | GitLab: one read per label | the OR filter is paid-tier only; the AND filter is wrong for "any of" |
| D8 | Bitbucket: no `labels` scope | its tracker has no labels; the option is not offered and a stored one falls back |
| D9 | The scope never changes the card JSON | prompts and goldens stay; "who is it assigned to" is its own issue |
| D10 | The scope is ignored when an external card-source command is on, and the wizard says so | the command defines its cards |
| D11 | The report cache is keyed by the tracker settings | a saved change shows at once without a cross-module event |

## Follow-ups (not part of this change)

| # | Follow-up | Why it is left out |
|---|---|---|
| F1 | Show who an issue is assigned to on the card | changes what the agents read and the prompt goldens; its own issue (D9) |
| F2 | Say so when more than 100 open issues are cut at the source | silent for `assigned` too today; a separate change to all scopes |
| F3 | Check the GitHub search OR-label syntax, the GitLab `labels=` reads and the Bitbucket query on real hosts | the suite only runs against fakes; `3_TEST_PLAN.md` is the check |
