# 118 Let a cycle run on its own, with an open sandbox network and the commands each agent ran

- Endereço: https://github.com/exatasmente/coxia/issues/118
- Estado: open
- Rótulos: enhancement, coxia
- Autor: exatasmente

## Descrição

## What should happen

A run of an agent cycle can go from the first stage to the end **on its own**, with its agents allowed to run commands, and the person can always see **which commands each agent ran**, while the run works and once it ends.

Today a run stops for the person in several places even when every agent is set to `autonomous`: each command of an agent with `shell: host` waits for "Allow" (`src/main/runner/service.ts`, `askNow`), the gates of the flow wait for a decision, and the push and the pull request always wait for a "yes" in Actions (`src/main/runner/publish.ts`). The sandbox has no way to reach the network beyond the registry proxy (`runner.sandbox.network` is `off | registry`; `bwrap` runs with `--unshare-net`, `src/main/sandbox/policy.ts`). Each command already becomes a line of the run's conversation (`runner.exec` / `runner.exec.host`, `src/main/runner/executor.ts`), but there is no list of the commands by agent.

### 1. Autonomy, set in two places

- **Workspace** (Settings › Runner): one autonomy block.
- **Flow**: the main flow (`devCycle.stages`) and each squad's own flow (`devCycle.flows[squad]`) has its own block, with a switch **"Use the workspace's setting"**, on by default.
  - While it is on, the workspace's block decides for that flow, and the flow's fields are shown disabled, with a tooltip that says the workspace decides.
  - While it is off, the flow's block decides, and the workspace's block has no effect on runs of that flow.
- **What a block holds**, every field off by default:
  - **Autonomous cycle**: every stage of the run starts by itself and hands its result on without waiting, whatever each agent's own `autonomous` is; comments go out the way an autonomous agent's do.
  - Under it, four separate choices, each only meaningful while "Autonomous cycle" is on:
    - **Host commands without asking**: the commands of an agent with `shell: host` run without the "Allow" question.
    - **Gates pass by themselves**: a gate of the flow is approved by the app, recorded as an automatic approval with the reason.
    - **Push without a "yes"**: the run's push goes through the door of Actions by itself, audited.
    - **Pull request without a "yes"**: the pull request is opened by itself, audited.
- Only the computer may turn any of these on; a paired browser may only turn them off. A workspace marked as test keeps refusing every external write, whatever the block says.
- A change takes effect at the next decision (the next stage start, command, gate, push or pull request), never in the middle of one.
- The run's screen says, in its header, that the run is autonomous and which of the four choices are on, and where they come from (workspace or flow).

### 2. Open network in the sandbox

`runner.sandbox.network` gets a third value, **`open`**: the sandbox shares the computer's network, with no proxy and no host list. Desktop only, off by default (existing workspaces keep what they have). Name resolution must work inside (the system's resolver configuration is often a link outside `/etc`). The stage prompt tells the agent that it has the network.

### 3. The commands each agent ran

- On the run's screen, a **Commands** section: by agent, then by stage, every command with its number, where it ran (sandbox or this computer), its result (exit code, timeout, refused, not allowed) and how long it took. It updates live while the run works.
- When the run ends (done, cancelled or failed), the app posts one message in the run's conversation with the same list, by agent.
- The list is built from what the run already records; it is never posted to the code host.

## Out of scope

- Answering a question that reached the person, a plugin's request, a provider out of budget and `wait` stages: they keep waiting for their event.
- Any per-run override at start time.

## Acceptance

- With the workspace's "Autonomous cycle" on and the flow on "Use the workspace's setting", a run with gates, a writing agent and a QA in the sandbox goes from start to the pull request without waiting for the person, for exactly the choices that are on; with a choice off, that step waits as it does today.
- With the flow's switch off, the flow's own block decides and the workspace's is ignored; the flow's fields are disabled while the switch is on.
- A test workspace refuses the push and the pull request even with both choices on.
- A paired browser cannot turn any autonomy field or the `open` network on.
- A command in a sandbox with `network: open` resolves a public name and reaches it; with `off` it still cannot.
- The run's screen lists every command of the run by agent and by stage, live; the end of the run posts the same list in its conversation.
- The schema migration leaves every existing workspace with everything off and its network as it was.

## Notes

Functional specification only; the solution design belongs to refinement and planning. This moves a rule the app holds today ("the push and the pull request always wait for the person"): the spec must say where that rule changes in the documentation and in the rules of the runner.

## Comentários

(sem comentários)
