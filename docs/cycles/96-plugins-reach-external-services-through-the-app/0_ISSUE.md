# Plugins reach external services through the app, with settings and stored secrets

## What should happen

A plugin can reach an external service **through the app**: it describes the request, and the app performs it — with a stored secret when the request needs one — and hands the response back to the plugin. A plugin never sees a secret value, and nothing it asks goes out without the person's permission.

This is what the integrations that come after the plugin platform need (a time tracker, an issue tracker, a chat webhook, a self-hosted search instance): most of them need a key, and some live on a local or private address that a plugin's sandbox cannot reach.

## What exists today

- A plugin runs in the stage sandbox; with the person's permission it reaches the hosts it declared, through the registry proxy, which tunnels HTTPS and refuses private addresses. It cannot carry a secret.
- A plugin's write goes to a local outbox of the workspace, through the audited door.
- Plugins have no settings of their own: a value that differs per person (an instance URL, an account id) has nowhere to live.

## What the person must decide

- How a plugin declares the requests it may make, and how the person sees and allows them (the permission contract of the plugin platform — once, for the session, always; an irreversible write announced with a deadline — should carry over).
- How a plugin's settings are declared and filled in, and how a secret setting is stored (by reference, in the secrets store).

## Acceptance

- A plugin can declare settings; the person fills them in on the computer; a secret setting is stored by reference and its value never reaches the plugin, the configuration file, an export, the log or the audit log.
- A plugin can ask the app to perform a request to a destination it declared (or one of its settings), with a secret placed by the app, and gets the response back.
- A request that writes goes through the same permission contract and the audit log as a plugin's write today; a test workspace refuses it.
- A request to a destination the plugin did not declare, or with a secret it did not declare, is refused with the reason.
- A workspace without plugins behaves as before.

## Notes

Functional specification only; the contract is for refinement and planning. Follows the plugin platform; the first plugin that needs it is the web search for the agents.

