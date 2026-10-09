# Triage of the test environment for stages

## Type

Feature request (not a bug, not a question, not a duplicate). The issue describes a new capability: a stage of a run can exercise the app under development with real configuration kept by the person per workspace — plain variables and secret references, delivered to allowed stages only, with masking and network confinement around them.

## Is it understandable as written

Yes, verified by reading the issue and the code it cites:

- The secrets store exists and matches what the issue says: secrets are kept by reference with `stored`, `command` and `env` sources, are shared across the data folder, and only the main process resolves a value. No workspace or stage scope exists for secrets.
- There are no plain workspace variables today; only per-plugin settings, as the issue states.
- The sandbox stage matches the description: an empty environment by default, network off unless the stage allows it, `registry` mode reaching only listed hosts on port 443 through the app's proxy (which refuses private and loopback addresses), `open` mode sharing the computer's whole network. Nothing the person chooses is added to the sandbox environment today.
- The host stage matches: it runs with the app's own environment, with credential-looking names removed, and has no file or network confinement.
- Redaction matches: pattern-based masking of known key prefixes and long opaque strings exists, plus exact-value masking for plugin requests; screenshots and evidence files are not redacted.
- The QA prompt asks the agent to start the app with an empty data folder; nothing enforces it on the host, as the issue says.

The request is reproducible-in-intent: it describes behavior to build, not an observed failure, so there is no scenario to run. Every claim it makes about today's behavior checked out against the code.

## What is missing

Nothing blocks understanding. The issue itself lists the open decisions (where the list lives per workspace or per repository, which stages receive it, how the app under test receives the values — environment, file, or its own `env` secret source —, how the declared hosts open the network, what is done about private addresses, how image evidence is handled, and whether test-only credentials are required or confirmed). These belong to the refinement and planning stage, not to a question to the reporter.

## Related issues

None found in this cycle's records. The issue itself notes it is close to the plugin-request design, where the app places the secret and the plugin never sees it, with the difference that here the value must reach the app under test inside an environment the agent also commands; refinement should reconcile the two designs rather than treat them as duplicates.

## Priority suggestion

`priority:high` (as labeled) is reasonable: QA is the first intended consumer, and today a QA stage cannot exercise any real integration, which limits the evidence the cycle can produce. The final call belongs to product refinement, not to this triage.

## Suggested squad

Plataforma: the work centers on the runtime — the secrets store, the sandbox and its network policy, the shells, and the security boundary — rather than on screens or the speech side.
