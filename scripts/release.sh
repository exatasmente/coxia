#!/usr/bin/env bash
# Opens a release branch and cuts its betas and its stable version locally: checks, version bump, changelog, commit and tag. It never pushes.
#
#   scripts/release.sh open <X.Y.Z> [--from v<A.B.C>] [--dry-run]
#   scripts/release.sh beta|<X.Y.Z-beta.N>|stable|<X.Y.Z> --author "Name <email>" [-m "<commit message>"] [options]
#
#   open X.Y.Z       creates and switches to release/X.Y.Z from main (a new minor or major), or from a stable tag with --from (a patch of it)
#   beta             on release/X.Y.Z: cuts X.Y.Z-beta.<next>; an explicit X.Y.Z-beta.N is accepted when N follows the latest beta
#   stable | X.Y.Z   on main: cuts X.Y.Z once a beta tag exists and release/X.Y.Z is merged into main; "stable" reads X.Y.Z from package.json's pre-release
#   --author         identity of the commit and the tag; also read from RELEASE_AUTHOR. Passed to git with -c: git config is never written
#   -m, --message    commit message (default "feat: release <version>"; the repository style is feat:/fix:, English, lowercase, no period)
#   --date <date>    date written in the changelog heading (default: today, YYYY-MM-DD)
#   --skip-checks    do not run tsc, tests, theme audit, i18n lint and the build (the public audit always runs)
#   --allow-branch   skip the branch rules (a beta on release/X.Y.Z only, a stable on main only); loud
#   --emergency      a stable for a hotfix that cannot wait for a beta: skips the beta, merge and remote rules; loud, and written in the tag
#   --worktree       run in a worktree of its own, where main is not a branch (the app's release steps): open cuts from origin/main when there is one, and a stable is cut on a
#                    detached HEAD that stands for main (merge release/X.Y.Z into origin/main's commit first); every other rule is the same. Note that a stable
#                    is accepted from a detached HEAD only with this option (the checks of the stable, the merged beta and the remote rules still apply)
#   --dry-run        validate and print the plan; change nothing
#
# Order: refuse a dirty tree, apply the branch and version rules, run the checks, bump package.json and package-lock.json (npm version
# --no-git-tag-version), update CHANGELOG.md (a beta moves [Unreleased] under its version; the stable folds the betas of the version and [Unreleased]
# into one section), commit, tag v<version>, then print the push commands and stop. When package.json already has the version and CHANGELOG.md
# already has its section (the first release), those steps are skipped. The process is in RELEASING.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() { sed -n '2,/^set -euo/{/^set -euo/!p}' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "release: $*" >&2; exit 1; }
warn() { echo "release: $*" >&2; }

ARGS=()
AUTHOR="${RELEASE_AUTHOR:-}"
MESSAGE=""
DATE="$(date +%Y-%m-%d)"
CHECKS=1
ALLOW_BRANCH=0
EMERGENCY=0
WORKTREE=0
FROM=""
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --author) AUTHOR="${2:?--author needs a value}"; shift ;;
    -m|--message) MESSAGE="${2:?--message needs a value}"; shift ;;
    --date) DATE="${2:?--date needs a value}"; shift ;;
    --from) FROM="${2:?--from needs a tag}"; shift ;;
    --skip-checks) CHECKS=0 ;;
    --allow-branch) ALLOW_BRANCH=1 ;;
    --emergency) EMERGENCY=1 ;;
    --worktree) WORKTREE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

[ "${#ARGS[@]}" -ge 1 ] || { usage; exit 2; }
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "--date must be YYYY-MM-DD"

# ---- what git knows (all local: the script never fetches) ------------------------------------------------------------------------------------
# Each number is 0 or has no leading zero: 0.06.0 would make the tag v0.06.0 and a package.json that says 0.6.0.
NUM='(0|[1-9][0-9]*)'
STABLE_RE="^$NUM\\.$NUM\\.$NUM\$"
TAG_RE="^v$NUM\\.$NUM\\.$NUM\$"
has_tag() { git rev-parse -q --verify "refs/tags/$1" >/dev/null; }
tag_commit() { git rev-parse -q --verify "refs/tags/$1^{commit}"; }
is_ancestor() { git merge-base --is-ancestor "$1" "$2"; }
ref_exists() { git show-ref --verify --quiet "$1"; }
# True when $1 is a version strictly above $2 (both X.Y.Z).
ver_gt() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n1)" = "$1" ]; }

# The highest stable tag (vX.Y.Z) of one major.minor ("0.5"), or of the whole repository when no argument is given. Empty when there is none.
stable_tag() {
  local line="${1:-}" tags
  if [ -n "$line" ]; then
    tags="$(git tag --list "v$line.*" | grep -E "^v${line//./\\.}\.$NUM\$" || true)"
  else
    tags="$(git tag --list 'v*' | grep -E "$TAG_RE" || true)"
  fi
  if [ -n "$tags" ]; then printf '%s\n' "$tags" | sort -V | tail -n1; fi
}

# The stable a version has to be above: the latest of its own major.minor, else the latest overall (a patch of an older line is fine).
floor_tag() {
  local own
  own="$(stable_tag "${1%.*}")"
  if [ -n "$own" ]; then echo "$own"; else stable_tag; fi
}

# The highest N of the tags v<core>-beta.N (0 when there is none).
max_beta() {
  local max=0 t n
  while IFS= read -r t; do
    n="${t#"v$1-beta."}"
    if [[ "$n" =~ ^[1-9][0-9]*$ ]] && [ "$n" -gt "$max" ]; then max="$n"; fi
  done < <(git tag --list "v$1-beta.*")
  echo "$max"
}

# The refs of release/<core> that exist here: the local branch and the remote-tracking one.
release_refs() {
  local r
  for r in "refs/heads/release/$1" "refs/remotes/origin/release/$1"; do
    if ref_exists "$r"; then echo "$r"; fi
  done
}

# What stands for main: the local branch, or, in a release worktree (where main is the person's checkout's branch and is never touched), what the remote has.
MAIN_REF=main
if [ "$WORKTREE" -eq 1 ] && ref_exists refs/remotes/origin/main; then MAIN_REF=origin/main; fi

# The highest version main carries: its package.json and every stable or beta tag reachable from it. Empty when main does not exist.
main_version() {
  local pkg="" tags=""
  git rev-parse -q --verify "$MAIN_REF^{commit}" >/dev/null || return 0
  pkg="$(git show "$MAIN_REF:package.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version" 2>/dev/null || true)"
  tags="$(git tag --merged "$MAIN_REF" --list 'v*' | sed -E 's/^v//; s/-.*$//' | grep -E "^$NUM\.$NUM\.$NUM\$" || true)"
  { echo "${pkg%%-*}"; printf '%s\n' "$tags"; } | grep -E "^$NUM\.$NUM\.$NUM\$" | sort -V | tail -n1 || true
}

# The two checks against the remote that need a tracking ref: one line when they cannot run (the script never fetches).
origin_skipped() { warn "no $1: the checks against the remote were skipped; this script never fetches, so run git fetch origin first"; }

# ---- open ---------------------------------------------------------------------------------------------------------------------------------
cmd_open() {
  local v="${ARGS[1]:-}" branch tag mm z floor line_tag base base_desc behind fv carried
  [ "${#ARGS[@]}" -le 2 ] || die "open takes one version"
  [[ "$v" =~ $STABLE_RE ]] || die "open needs a stable version X.Y.Z, without a suffix or a leading v (got '${v:-nothing}')"
  [ "$EMERGENCY" -eq 0 ] || die "--emergency applies to a stable cut, not to open"
  branch="release/$v"; tag="v$v"; mm="${v%.*}"; z="${v##*.}"
  [ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the working tree is not clean: commit or stash first"; }
  if ref_exists "refs/heads/$branch" || ref_exists "refs/remotes/origin/$branch"; then die "$branch already exists"; fi
  if has_tag "$tag"; then die "tag $tag already exists: $v is released"; fi
  if [ -n "$(git tag --list "$tag-beta.*")" ]; then die "$v already has a beta tag: continue on its release branch, or take the next version"; fi
  floor="$(floor_tag "$v")"
  line_tag="$(stable_tag "$mm")"

  if [ -n "$FROM" ]; then
    [[ "$FROM" =~ $TAG_RE ]] || die "--from takes a stable tag such as v$mm.0 (got '$FROM')"
    has_tag "$FROM" || die "tag $FROM does not exist"
    fv="${FROM#v}"
    [ "${fv%.*}" = "$mm" ] || die "--from is for a patch: $FROM is not a $mm.x version"
    [ "$FROM" = "$line_tag" ] || die "--from must be the latest stable of $mm.x, $line_tag (got $FROM)"
    [ "${fv##*.}" -lt "$z" ] || die "$v is not above $FROM"
    carried="$(main_version)"
    if [ -n "$carried" ] && [ "${carried%.*}" != "$mm" ] && ver_gt "${carried%.*}.0" "$mm.0"; then
      die "main already carries a newer line ($carried) than $v: hotfixing an older line while main has moved on is not supported by this flow (RELEASING.md says what to do instead)"
    fi
    base="$FROM"; base_desc="the tag $FROM"
  else
    git rev-parse -q --verify "$MAIN_REF^{commit}" >/dev/null || die "there is no local main to cut from"
    if [ "$MAIN_REF" = main ] && ref_exists refs/remotes/origin/main; then
      behind="$(git rev-list --count main..origin/main)"
      [ "$behind" -eq 0 ] || die "main is $behind commit(s) behind origin/main: update it first (git fetch, then fast-forward main)"
    fi
    if [ -n "$line_tag" ]; then
      # The same major.minor as a released version is a patch, and a patch comes from the stable tag, not from whatever main holds now.
      [ "$(git rev-parse "$MAIN_REF")" = "$(tag_commit "$line_tag")" ] || die "$v is a patch of $line_tag: cut it from the tag (scripts/release.sh open $v --from $line_tag); main has moved since"
    fi
    base="$MAIN_REF"; base_desc="$MAIN_REF ($(git rev-parse --short "$MAIN_REF"))"
  fi
  if [ -n "$floor" ] && ! ver_gt "$v" "${floor#v}"; then die "$v is not above the latest stable ${floor#v}"; fi
  if [ -z "$FROM" ]; then
    carried="$(main_version)"
    if [ -n "$carried" ] && ver_gt "$carried" "$v"; then
      die "$v is below $carried, which main already carries (its package.json or a tag reachable from it): take a version above it"
    fi
  fi

  echo "release: open $branch from $base_desc"
  if [ "$DRY" -eq 1 ]; then echo "release: dry run, nothing changed"; exit 0; fi
  git switch -q -c "$branch" "$base"
  echo "release: created $branch and switched to it (nothing was pushed)"
  cat <<EOF

Make the version known to everyone (the pull requests of its issues target $branch):

  git push -u origin $branch

Cut its first beta when the work is in: scripts/release.sh beta --author "Name <email>"
EOF
  exit 0
}

if [ "${ARGS[0]}" = "open" ]; then cmd_open; fi

# ---- the version: what the argument says and where we stand ----------------------------------------------------------------------------------
[ "${#ARGS[@]}" -eq 1 ] || die "more than one version given"
ARG="${ARGS[0]}"
[ -z "$FROM" ] || die "--from belongs to open"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
CURRENT="$(node -p "require('./package.json').version")"
BRANCH_CORE=""
if [[ "$BRANCH" =~ ^release/($NUM\.$NUM\.$NUM)$ ]]; then BRANCH_CORE="${BASH_REMATCH[1]}"; fi

case "$ARG" in
  beta)
    [ -n "$BRANCH_CORE" ] || die "on branch '$BRANCH': a beta is cut on release/X.Y.Z, which names the version (scripts/release.sh open X.Y.Z makes it)"
    VERSION="$BRANCH_CORE-beta.$(($(max_beta "$BRANCH_CORE") + 1))" ;;
  stable)
    [[ "$CURRENT" == *-* ]] || die "package.json says $CURRENT, which is already a stable version: name the version to release (scripts/release.sh X.Y.Z)"
    VERSION="${CURRENT%%-*}" ;;
  *) VERSION="$ARG" ;;
esac

[[ "$VERSION" =~ ^$NUM\.$NUM\.$NUM(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]] || die "'$VERSION' is not a semver version without the leading v (0.2.0, 0.2.0-beta.1), nor beta, stable or open"
CORE="${VERSION%%-*}"
KIND=stable
if [[ "$VERSION" == *-* ]]; then
  KIND=beta
  [[ "$VERSION" =~ ^$NUM\.$NUM\.$NUM-beta\.[1-9][0-9]*$ ]] || die "a pre-release is ${CORE}-beta.N with N a positive integer (got $VERSION): only the beta channel is wired into the app"
fi
if [ "$EMERGENCY" -eq 1 ] && [ "$KIND" != stable ]; then die "--emergency applies to a stable cut, not to a beta: a beta is the short path already"; fi

[[ "$AUTHOR" =~ ^[^\<\>]+\ \<[^\<\>@\ ]+@[^\<\>@\ ]+\>$ ]] || die "give the identity with --author \"Name <email>\" (or RELEASE_AUTHOR); git config is never used"
NAME="${AUTHOR%% <*}"
EMAIL="${AUTHOR##*<}"; EMAIL="${EMAIL%>}"
TAG="v$VERSION"
MESSAGE="${MESSAGE:-feat: release $VERSION}"
GIT_ID=(-c "user.name=$NAME" -c "user.email=$EMAIL")

# ---- the tree, the branch and the tag --------------------------------------------------------------------------------------------------------
[ -z "$(git status --porcelain)" ] || { git status --short >&2; die "the working tree is not clean: commit or stash first"; }

LOUD=()
if [ "$KIND" = beta ]; then
  if [ "$BRANCH_CORE" != "$CORE" ]; then
    if [ "$ALLOW_BRANCH" -eq 1 ]; then
      LOUD+=("--allow-branch: $VERSION is cut on '$BRANCH' instead of release/$CORE")
    elif [ -z "$BRANCH_CORE" ]; then
      die "on branch '$BRANCH': a beta is cut on release/$CORE (scripts/release.sh open $CORE makes it; --allow-branch overrides)"
    else
      die "the branch release/$BRANCH_CORE cuts $BRANCH_CORE-beta.N, not $VERSION: the number must match the branch (--allow-branch overrides)"
    fi
  fi
elif [ "$BRANCH" != "main" ] && ! { [ "$WORKTREE" -eq 1 ] && [ "$BRANCH" = HEAD ]; }; then
  if [ "$ALLOW_BRANCH" -eq 1 ]; then
    LOUD+=("--allow-branch: $VERSION is cut on '$BRANCH' instead of main")
  else
    die "on branch '$BRANCH': a stable is cut on main, after release/$CORE is merged into it (--allow-branch overrides)"
  fi
fi
if has_tag "$TAG"; then die "tag $TAG already exists"; fi

FLOOR="$(floor_tag "$CORE")"
if [ -n "$FLOOR" ] && ! ver_gt "$CORE" "${FLOOR#v}"; then die "$VERSION is not above the latest stable ${FLOOR#v}"; fi

LAST_BETA="$(max_beta "$CORE")"
if [ "$KIND" = beta ]; then
  N="${VERSION##*.}"
  if [ "$N" -le "$LAST_BETA" ]; then die "beta.$N is not above the latest beta of $CORE, beta.$LAST_BETA: the next is $CORE-beta.$((LAST_BETA + 1))"; fi
  if [ "$N" -gt $((LAST_BETA + 1)) ]; then warn "beta.$N skips a number: the next in line is beta.$((LAST_BETA + 1))"; fi
  # What the remote has on the release branch must be in HEAD, or the tag would sit on a commit that the push of the branch is rejected for.
  if ref_exists "refs/remotes/origin/release/$CORE"; then
    is_ancestor "refs/remotes/origin/release/$CORE" HEAD || die "origin/release/$CORE has commits that $BRANCH lacks (behind or diverged): git fetch origin, then merge or fast-forward it before the beta"
  else
    origin_skipped "origin/release/$CORE"
  fi
fi

# A stable is a tested beta: a beta tag exists, it is in main, and the release branch holds nothing newer than it.
SKIPPED=()
NOTES=()
if [ "$KIND" = stable ]; then
  PROBLEMS=()
  BETA_SHA=""
  if [ "$LAST_BETA" -eq 0 ]; then
    PROBLEMS+=("no tag v$CORE-beta.* exists: $CORE has not been through the beta")
  else
    BETA_TAG="v$CORE-beta.$LAST_BETA"
    BETA_SHA="$(tag_commit "$BETA_TAG")"
    is_ancestor "$BETA_SHA" HEAD || PROBLEMS+=("$BETA_TAG is not in $BRANCH: merge release/$CORE into it first")
  fi
  if ref_exists refs/remotes/origin/main; then
    is_ancestor refs/remotes/origin/main HEAD || PROBLEMS+=("origin/main has commits that $BRANCH lacks (behind or diverged): git fetch origin, then merge or fast-forward it first")
  else
    origin_skipped "origin/main"
  fi
  REFS="$(release_refs "$CORE")"
  if [ -z "$REFS" ]; then
    NOTES+=("release/$CORE no longer exists here: the beta tag stands for it")
  else
    while IFS= read -r ref; do
      name="${ref#refs/heads/}"; name="${name#refs/remotes/}"
      tip="$(git rev-parse "$ref")"
      if ! is_ancestor "$tip" HEAD; then
        PROBLEMS+=("$name is not merged into $BRANCH")
      elif [ -n "$BETA_SHA" ] && [ "$tip" != "$BETA_SHA" ]; then
        PROBLEMS+=("$name is $(git rev-list --count "$BETA_SHA..$tip") commit(s) ahead of $BETA_TAG: nobody tried them, cut another beta first")
      fi
    done <<< "$REFS"
  fi
  if [ "${#PROBLEMS[@]}" -gt 0 ]; then
    if [ "$EMERGENCY" -eq 1 ]; then
      SKIPPED=("${PROBLEMS[@]}")
    else
      for p in "${PROBLEMS[@]}"; do echo "release: $p" >&2; done
      die "refusing the stable $VERSION (a hotfix that cannot wait for a beta uses --emergency, which is recorded in the tag)"
    fi
  elif [ "$EMERGENCY" -eq 1 ]; then
    NOTES+=("--emergency was given, but every rule held: nothing was skipped")
  fi
fi

# ---- the changelog and the version -----------------------------------------------------------------------------------------------------------
HAS_SECTION=0
case "$(node scripts/release-changelog.mjs status CHANGELOG.md "$VERSION")" in
  section) HAS_SECTION=1 ;;
  content) ;;
  *) die "CHANGELOG.md: [Unreleased] is empty and there is no [$VERSION] section (nor a beta section to fold); describe the changes first" ;;
esac
if [ "$CURRENT" != "$VERSION" ]; then
  LOWEST="$(printf '%s\n%s\n' "${CURRENT%%-*}" "$CORE" | sort -V | head -n1)"
  [ "$LOWEST" = "${CURRENT%%-*}" ] || die "$VERSION is lower than the current $CURRENT"
fi

loud() {
  if [ "${#LOUD[@]}" -eq 0 ] && [ "${#SKIPPED[@]}" -eq 0 ]; then return 0; fi
  echo "release: !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
  if [ "${#SKIPPED[@]}" -gt 0 ]; then echo "release: !! EMERGENCY: this stable skips the beta and remote rules" >&2; fi
  for l in ${LOUD[@]+"${LOUD[@]}"}; do echo "release: !! $l" >&2; done
  for s in ${SKIPPED[@]+"${SKIPPED[@]}"}; do echo "release: !! skipped: $s" >&2; done
  echo "release: !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
}

echo "release: $TAG from $BRANCH ($(git rev-parse --short HEAD)); package.json is $CURRENT"
echo "release: commit and tag as $NAME <$EMAIL>; message: $MESSAGE"
if [ "$KIND" = beta ]; then echo "release: pre-release: published on the beta update channel"; fi
for n in ${NOTES[@]+"${NOTES[@]}"}; do echo "release: note: $n"; done
loud
# The public audit is a safety gate, not a check: it runs even with --skip-checks and in a dry run.
node scripts/public-audit.mjs || die "the public audit failed: nothing of a company or a person may reach a release"

if [ "$DRY" -eq 1 ]; then
  [ "$CURRENT" = "$VERSION" ] || echo "release: would bump package.json to $VERSION"
  if [ "$HAS_SECTION" -eq 1 ]; then
    echo "release: CHANGELOG.md already has [$VERSION]"
  elif [ "$KIND" = stable ]; then
    echo "release: would fold the [$CORE-beta.*] sections and [Unreleased] into [$VERSION] - $DATE"
  else
    echo "release: would move [Unreleased] under [$VERSION] - $DATE"
  fi
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
  echo "release: CHANGELOG.md: $(node scripts/release-changelog.mjs cut CHANGELOG.md "$VERSION" "$DATE")"
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
TAG_MSG=(-m "Coxia $VERSION")
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  TAG_MSG=(-m "Coxia $VERSION (emergency: rules were skipped)")
  for s in "${SKIPPED[@]}"; do TAG_MSG+=(-m "skipped: $s"); done
fi
git "${GIT_ID[@]}" tag -a "$TAG" "${TAG_MSG[@]}"
echo "release: tagged $TAG"
loud

if [ "$KIND" = beta ]; then
  NEXT_STEP="The workflow builds a DRAFT pre-release for $TAG; publish it from the Releases page after checking it (see RELEASING.md). Only apps on the beta channel receive it."
  AFTER=""
else
  NEXT_STEP="The workflow builds a DRAFT release for $TAG; publish it from the Releases page after checking it (see RELEASING.md). Everyone on the stable channel receives it."
  AFTER="
When the draft is published, delete the release branch (these commands are only printed):

  git branch -d release/$CORE
  git push origin --delete release/$CORE
"
fi
# A stable cut on the detached HEAD of a release worktree is pushed to main by name.
PUSH_REF="$BRANCH"
if [ "$BRANCH" = HEAD ]; then PUSH_REF="HEAD:refs/heads/main"; fi
cat <<EOF

Done locally. Nothing was pushed. Review the commit and the tag, then push (this starts the release workflow):

  git push origin $PUSH_REF
  git push origin $TAG

$NEXT_STEP
To back out before pushing, delete the tag (git tag -d $TAG) and, if a release commit was made, drop it with git reset --hard HEAD~1 (it only
holds the version bump and the changelog).$AFTER
EOF
