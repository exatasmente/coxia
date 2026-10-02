#!/usr/bin/env bash
# Prepares a release locally: checks, version bump, changelog, commit and tag. It never pushes.
#
#   scripts/release.sh <version> --author "Name <email>" [-m "<commit message>"] [options]
#
#   <version>        semver without the leading v: 0.2.0, or a pre-release such as 0.2.0-beta.1
#   --author         identity of the commit and the tag; also read from RELEASE_AUTHOR. Passed to git with -c: git config is never written
#   -m, --message    commit message (default "feat: release <version>"; the repository style is feat:/fix:, English, lowercase, no period)
#   --date <date>    date written in the changelog heading (default: today, YYYY-MM-DD)
#   --skip-checks    do not run tsc, tests, theme audit, i18n lint and the build (the public audit always runs)
#   --allow-branch   allow releasing from a branch other than main
#   --dry-run        validate and print the plan; change nothing
#
# Order: refuse a dirty tree, run the checks, bump package.json and package-lock.json (npm version --no-git-tag-version), move the
# [Unreleased] entries of CHANGELOG.md under the new version, commit, tag v<version>, then print the push commands and stop.
# When package.json already has the version and CHANGELOG.md already has its section (the first release), those steps are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "release: $*" >&2; exit 1; }

VERSION=""
AUTHOR="${RELEASE_AUTHOR:-}"
MESSAGE=""
DATE="$(date +%Y-%m-%d)"
CHECKS=1
ALLOW_BRANCH=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --author) AUTHOR="${2:?--author needs a value}"; shift ;;
    -m|--message) MESSAGE="${2:?--message needs a value}"; shift ;;
    --date) DATE="${2:?--date needs a value}"; shift ;;
    --skip-checks) CHECKS=0 ;;
    --allow-branch) ALLOW_BRANCH=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) [ -z "$VERSION" ] || die "more than one version given"; VERSION="$1" ;;
  esac
  shift
done

[ -n "$VERSION" ] || { usage; exit 2; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]] || die "'$VERSION' is not a semver version without the leading v (0.2.0, 0.2.0-beta.1)"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--date must be YYYY-MM-DD"
[[ "$AUTHOR" =~ ^[^\<\>]+\ \<[^\<\>@\ ]+@[^\<\>@\ ]+\>$ ]] || die "give the identity with --author \"Name <email>\" (or RELEASE_AUTHOR); git config is never used"
NAME="${AUTHOR%% <*}"
EMAIL="${AUTHOR##*<}"; EMAIL="${EMAIL%>}"
TAG="v$VERSION"
MESSAGE="${MESSAGE:-feat: release $VERSION}"
GIT_ID=(-c "user.name=$NAME" -c "user.email=$EMAIL")

# ---- the tree and the tag ------------------------------------------------------------------------------------------------------------------
[ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the working tree is not clean: commit or stash first"; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ] && [ "$ALLOW_BRANCH" -ne 1 ]; then die "on branch '$BRANCH': releases are cut from main (--allow-branch to override)"; fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then die "tag $TAG already exists"; fi

CURRENT="$(node -p "require('./package.json').version")"
HAS_SECTION=0
if grep -qF "## [$VERSION]" CHANGELOG.md; then HAS_SECTION=1; fi
UNRELEASED="$(awk '/^## \[Unreleased\]/ {on=1; next} /^## \[/ {on=0} /^\[[^]]+\]: / {on=0} on' CHANGELOG.md | tr -d '[:space:]')"
if [ "$HAS_SECTION" -eq 0 ] && [ -z "$UNRELEASED" ]; then die "CHANGELOG.md: [Unreleased] is empty and there is no [$VERSION] section; describe the changes first"; fi
if [ "$CURRENT" != "$VERSION" ]; then
  LOWEST="$(printf '%s\n%s\n' "${CURRENT%%-*}" "${VERSION%%-*}" | sort -V | head -n1)"
  [ "$LOWEST" = "${CURRENT%%-*}" ] || die "$VERSION is lower than the current $CURRENT"
fi

echo "release: $TAG from $BRANCH ($(git rev-parse --short HEAD)); package.json is $CURRENT"
echo "release: commit and tag as $NAME <$EMAIL>; message: $MESSAGE"
if [[ "$VERSION" == *-* ]]; then echo "release: pre-release: published on the beta update channel"; fi
# The public audit is a safety gate, not a check: it runs even with --skip-checks and in a dry run.
node scripts/public-audit.mjs || die "the public audit failed: nothing of a company or a person may reach a release"

if [ "$DRY" -eq 1 ]; then
  [ "$CURRENT" = "$VERSION" ] || echo "release: would bump package.json to $VERSION"
  [ "$HAS_SECTION" -eq 1 ] || echo "release: would move [Unreleased] under [$VERSION] - $DATE"
  echo "release: dry run, nothing changed"
  exit 0
fi

# ---- checks -------------------------------------------------------------------------------------------------------------------------------
if [ "$CHECKS" -eq 1 ]; then
  echo "release: running the checks (the same as CI)"
  npx tsc --noEmit
  npx vitest run
  node scripts/theme-audit.mjs
  npm run --silent i18n:lint
  npx electron-vite build
  [ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the checks changed tracked files"; }
fi

# ---- version and changelog ------------------------------------------------------------------------------------------------------------------
if [ "$CURRENT" != "$VERSION" ]; then
  npm version "$VERSION" --no-git-tag-version >/dev/null
  echo "release: package.json is now $VERSION"
fi

if [ "$HAS_SECTION" -eq 0 ]; then
  PREV="$(sed -n 's#^\[Unreleased\]: .*/compare/v\([^.]*\.[^.]*\.[^.]*\)\.\.\.HEAD$#\1#p' CHANGELOG.md | head -n1)"
  BASE="$(sed -n 's#^\[Unreleased\]: \(.*\)/compare/.*$#\1#p' CHANGELOG.md | head -n1)"
  TMP="$(mktemp)"
  awk -v v="$VERSION" -v date="$DATE" -v prev="$PREV" -v base="$BASE" '
    /^## \[Unreleased\]/ { print; print ""; print "## [" v "] - " date; next }
    /^\[Unreleased\]: / && base != "" {
      print "[Unreleased]: " base "/compare/v" v "...HEAD"
      if (prev != "") print "[" v "]: " base "/compare/v" prev "...v" v
      else print "[" v "]: " base "/releases/tag/v" v
      next
    }
    { print }
  ' CHANGELOG.md > "$TMP"
  cat "$TMP" > CHANGELOG.md
  rm -f "$TMP"
  echo "release: CHANGELOG.md: [Unreleased] moved under [$VERSION] - $DATE"
fi
scripts/release-notes.sh "$VERSION" > /dev/null || die "CHANGELOG.md has no usable entry for $VERSION"

# ---- commit and tag -----------------------------------------------------------------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  git add package.json package-lock.json CHANGELOG.md
  git "${GIT_ID[@]}" commit -q -m "$MESSAGE"
  echo "release: committed $(git rev-parse --short HEAD)"
else
  echo "release: nothing to commit (version and changelog were already in place)"
fi
git "${GIT_ID[@]}" tag -a "$TAG" -m "Coxia $VERSION"
echo "release: tagged $TAG"

cat <<EOF

Done locally. Nothing was pushed. Review the commit and the tag, then push (this starts the release workflow):

  git push origin $BRANCH
  git push origin $TAG

The workflow builds the public packages and creates a DRAFT release for $TAG; publish it from the Releases page after checking it
(see RELEASING.md). To back out before pushing, delete the tag (git tag -d $TAG) and, if a release commit was made, drop it
with git reset --hard HEAD~1 (it only holds the version bump and the changelog).
EOF
