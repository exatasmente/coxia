#!/bin/sh
# The example plugin of the kit: it searches the web when a stage finishes and prints a document with the result
# and the source it came from. It is the base of the first delivery (web search for the agents).
#
# It runs inside the stage sandbox: no network by default, and the network only through the destinations the
# person listed for the workspace (runner.sandbox). The query is the event name the app passes as the first
# argument; a real plugin would build it from the stage's work.
#
# Without the network the search fails with the reason, and a real plugin would say so; here the refusal is
# caught so the example never breaks a stage.
set -eu

event="${1:-}"

# The destination the plugin declared. It is reached only if the person listed it for the workspace; without the
# list the request never leaves the sandbox.
destination="search.example.com"
query="web search for the event ${event}"

if ! command -v curl >/dev/null 2>&1; then
  echo "no command to reach the network is available in the sandbox"
  exit 0
fi

# A refusal (the destination is not in the workspace's list) is told, not hidden: the reason is what the person
# needs to grant it.
result="$(curl -fsS --max-time 20 "https://${destination}/search?q=$(printf '%s' "${query}" | tr ' ' '+')" 2>&1)" || {
  echo "network refused for ${destination}: ${result}"
  exit 0
}

printf '# Web search\n\n- source: https://%s\n\n%s\n' "${destination}" "${result}"
