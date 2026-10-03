#!/usr/bin/env bash
# Checks that the commit a release tag points at is on the branch it belongs to on the remote, so a tag pushed from a local-only or stale commit does not
# publish what no branch carries.
#
#   scripts/verify-release-origin.sh <version> [commit]      (commit defaults to HEAD)
#
# - a stable version (0.6.0) must be reachable from origin/main;
# - a beta (0.6.0-beta.2) must be reachable from origin/release/0.6.0.
# Reads the remote-tracking refs of the checkout (a workflow needs fetch-depth 0); it never fetches. Used by .github/workflows/release.yml.
set -euo pipefail

version="${1:-}"
[ -n "$version" ] || { echo "usage: $0 <version> [commit]" >&2; exit 2; }
commit="$(git rev-parse --verify -q "${2:-HEAD}^{commit}")" || { echo "verify-origin: no such commit: ${2:-HEAD}" >&2; exit 1; }

if [[ "$version" == *-* ]]; then branch="release/${version%%-*}"; else branch="main"; fi
ref="refs/remotes/origin/$branch"
git show-ref --verify --quiet "$ref" || { echo "verify-origin: origin/$branch does not exist: push the branch before the tag for $version" >&2; exit 1; }
git merge-base --is-ancestor "$commit" "$ref" || { echo "verify-origin: the commit of v$version is not on origin/$branch: push $branch first (and fetch before cutting, so the tag sits on what the branch has)" >&2; exit 1; }
echo "verify-origin: ok: ${commit:0:9} is on origin/$branch"
