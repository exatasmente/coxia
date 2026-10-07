#!/usr/bin/env bash
# QA scratch: builds a throwaway data root for the GUI check of the runs screen. Never touches the real workspace.
set -eu
OUT=/coxia/out/mkdata
rm -rf "$OUT"
mkdir -p /coxia/out/gui-data
DATA=/coxia/out/gui-data
WS="$DATA/workspaces/testes"
mkdir -p "$WS"
printf '%s\n' '{"current":"testes","list":[{"id":"testes","name":"Testes","createdAt":"2026-10-07T00:00:00.000Z","test":false}]}' > "$DATA/workspaces.json"
printf '%s\n' '{"version":1,"at":"2026-10-07T00:00:00.000Z","existingInstall":false,"legacyWorkspaces":[]}' > "$DATA/config-migration.json"
cat > "$WS/config.json" <<'JSON'
{
  "schemaVersion": 15,
  "setupComplete": true,
  "language": "en",
  "userName": "",
  "appearance": { "theme": "light" },
  "notifications": false,
  "closeToTray": false,
  "llm": {
    "providers": [{ "id": "anthropic", "kind": "anthropic", "engine": "claude-sdk", "baseUrl": "https://api.anthropic.com", "secretRef": "llm.anthropic" }],
    "roles": {
      "turn": { "provider": "anthropic", "model": "haiku" },
      "reply": { "provider": "anthropic", "model": "haiku" },
      "deep": { "provider": "anthropic", "model": "sonnet" },
      "teams": { "provider": "anthropic", "model": "haiku" },
      "fix": { "provider": "anthropic", "model": "haiku" }
    }
  },
  "projects": { "repos": [], "roots": [], "autoDiscover": false },
  "vcs": [],
  "devCycle": { "templateId": "agent-flow" },
  "quads": [],
  "runner": { "enabled": false, "triggerLabel": "coxia" }
}
JSON
# The exit door of a real run is never reached in this check: the fake host answers before any provider call.
mkdir -p "$WS"
ls -la "$DATA" "$WS"
