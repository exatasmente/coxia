#!/usr/bin/env bash
# Prints the CHANGELOG.md section of one version (the text under "## [<version>]", without the heading).
#
#   scripts/release-notes.sh <version> [changelog-file]
#
# Exit status: 0 with the section on stdout; 3 when the version has no section or the section is empty.
# Used by .github/workflows/release.yml (release body) and scripts/release.sh.
set -euo pipefail

version="${1:-}"
file="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/CHANGELOG.md}"
[ -n "$version" ] || { echo "usage: $0 <version> [changelog-file]" >&2; exit 2; }
[ -f "$file" ] || { echo "no changelog at $file" >&2; exit 3; }

section="$(awk -v v="$version" '
  /^## \[/ { if (on) exit; on = (index($0, "## [" v "]") == 1); next }
  /^\[[^]]+\]: / { if (on) exit }
  on { print }
' "$file")"

# Trim leading and trailing blank lines.
section="$(printf '%s\n' "$section" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"
if [ -z "${section//[[:space:]]/}" ]; then
  echo "CHANGELOG.md has no entry for $version" >&2
  exit 3
fi
printf '%s\n' "$section"
