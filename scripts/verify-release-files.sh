#!/usr/bin/env bash
# Checks the Linux files of a release build before they are uploaded (or attached to a draft): the AppImage, the .deb and the update feed.
#
#   scripts/verify-release-files.sh <version> [dir]      (dir defaults to dist/)
#
# - the AppImage and the .deb carry the version in their names;
# - the feed is latest-linux.yml for a final version and <id>-linux.yml for a pre-release, where <id> is the first identifier after the
#   dash (0.2.0-beta.1 -> beta-linux.yml, the file electron-updater reads on the beta channel), with the same version;
# - the feed names the AppImage and its sha512 matches the file (what electron-updater verifies on the user's machine).
# Used by .github/workflows/release.yml and by hand on the output of `npm run dist:public`.
set -euo pipefail

version="${1:-}"
dir="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/dist}"
[ -n "$version" ] || { echo "usage: $0 <version> [dir]" >&2; exit 2; }

fail=0
bad() { echo "verify: $*" >&2; fail=1; }

appimage="cerimonias-$version.AppImage"
deb="cerimonias_${version}_amd64.deb"
feed="latest-linux.yml"
if [[ "$version" == *-* ]]; then pre="${version#*-}"; feed="${pre%%.*}-linux.yml"; fi

for f in "$appimage" "$deb" "$feed"; do
  [ -s "$dir/$f" ] || bad "missing $f in $dir"
done
[ "$fail" -eq 0 ] || exit 1

grep -q "^version: $version\$" "$dir/$feed" || bad "$feed does not say version: $version"
grep -q "^path: $appimage\$" "$dir/$feed" || bad "$feed does not point at $appimage"
want="$(sed -n 's/^sha512: //p' "$dir/$feed" | head -n1)"
got="$(openssl dgst -sha512 -binary "$dir/$appimage" | openssl base64 -A)"
[ "$want" = "$got" ] || bad "sha512 in $feed does not match $appimage"
[[ "$version" == *-* ]] && [ -e "$dir/latest-linux.yml" ] && bad "a pre-release must not produce latest-linux.yml (it would move the stable channel)"

[ "$fail" -eq 0 ] || exit 1
echo "verify: ok: $appimage, $deb and $feed ($(stat -c %s "$dir/$appimage") bytes, sha512 matches)"
