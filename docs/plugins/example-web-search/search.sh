#!/bin/sh
# The example plugin of the kit: it searches the web when a stage finishes and prints a document with the result
# and the source it came from. It is the base of the first delivery (web search for the agents).
#
# It runs inside the stage sandbox, handed over as the command itself (the plugin folder is never mounted), with
# the event name as $1. It reaches the network only after the person allowed it, and then only the destination it
# declared in plugin.json; until then the app does not run it and asks the person in Actions. The query is the
# event name; a real plugin would build it from the stage's work.
#
# What it prints becomes the document 7_WEB_SEARCH.md of the run's cycle folder, and the text of the write it
# declared (to its outbox, "results"), which goes out only with the person's permission.
set -eu

event="${1:-}"

# The destination the plugin declared: the only one its sandbox reaches, and only once the person allowed it.
destination="search.example.com"
query="web search for the event ${event}"

if ! command -v curl >/dev/null 2>&1; then
  echo "no command to reach the network is available in the sandbox"
  exit 0
fi

# A refusal is told, not hidden: the reason is what the person needs to see.
result="$(curl -fsS --max-time 20 "https://${destination}/search?q=$(printf '%s' "${query}" | tr ' ' '+')" 2>&1)" || {
  echo "network refused for ${destination}: ${result}"
  exit 0
}

printf '# Web search\n\n- source: https://%s\n\n%s\n' "${destination}" "${result}"
