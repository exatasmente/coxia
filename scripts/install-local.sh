#!/usr/bin/env bash
# Installs (or updates) the built Cerimônias AppImage for the current user only.
#
#   npm run dist && scripts/install-local.sh [--autostart] [--artifact <file.AppImage>]
#
# Writes only under the user's home:
#   ~/.local/opt/cerimonias/cerimonias.AppImage                 the app
#   ~/.local/share/icons/hicolor/256x256/apps/cerimonias.png    icon
#   ~/.local/share/applications/cerimonias.desktop              launcher entry
#   ~/.config/autostart/cerimonias.desktop                      only with --autostart
# Safe to run again: unchanged files are left alone, a new build replaces the AppImage atomically.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${CERIMONIAS_PREFIX:-$HOME/.local/opt/cerimonias}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
APP="$PREFIX/cerimonias.AppImage"
ICON_DIR="$DATA_HOME/icons/hicolor/256x256/apps"
LAUNCHER="$DATA_HOME/applications/cerimonias.desktop"
AUTOSTART_FILE="$CONFIG_HOME/autostart/cerimonias.desktop"

AUTOSTART=0
ARTIFACT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --autostart) AUTOSTART=1 ;;
    --artifact) ARTIFACT="${2:?--artifact needs a file}"; shift ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$ARTIFACT" ]; then
  # Newest AppImage in dist/ (version sort puts 0.10.0 after 0.9.0).
  ARTIFACT="$(ls -1 "$ROOT"/dist/*.AppImage 2>/dev/null | sort -V | tail -n 1 || true)"
fi
if [ -z "$ARTIFACT" ] || [ ! -f "$ARTIFACT" ]; then
  echo "No AppImage found. Run 'npm run dist' first (or pass --artifact <file>)." >&2
  exit 1
fi

say() { printf '%s\n' "$*"; }

write_if_changed() { # write_if_changed <target> <mode>; content on stdin
  local target="$1" mode="$2" tmp
  tmp="$(mktemp "$target.XXXXXX")"
  cat > "$tmp"
  if [ -f "$target" ] && cmp -s "$tmp" "$target"; then
    rm -f "$tmp"; say "unchanged  $target"
  else
    chmod "$mode" "$tmp"; mv -f "$tmp" "$target"; say "written    $target"
  fi
}

mkdir -p "$PREFIX" "$ICON_DIR" "$(dirname "$LAUNCHER")"

# 1. AppImage: copy next to the destination, then rename over it, so a running copy is never truncated.
if [ -f "$APP" ] && cmp -s "$ARTIFACT" "$APP"; then
  say "unchanged  $APP"
else
  was_installed=0; [ -f "$APP" ] && was_installed=1
  cp -f "$ARTIFACT" "$APP.new"
  chmod 755 "$APP.new"
  mv -f "$APP.new" "$APP"
  if [ "$was_installed" = 1 ]; then say "updated    $APP  (from $(basename "$ARTIFACT"))"; else say "installed  $APP  (from $(basename "$ARTIFACT"))"; fi
fi

# 2. Icon
if [ -f "$ICON_DIR/cerimonias.png" ] && cmp -s "$ROOT/resources/icon.png" "$ICON_DIR/cerimonias.png"; then
  say "unchanged  $ICON_DIR/cerimonias.png"
else
  cp -f "$ROOT/resources/icon.png" "$ICON_DIR/cerimonias.png"; say "written    $ICON_DIR/cerimonias.png"
fi

# 3. Launcher entry
write_if_changed "$LAUNCHER" 644 <<EOF
[Desktop Entry]
Type=Application
Name=Cerimônias
Comment=Cerimônias por voz com agentes por atividade
Exec=$APP
Icon=cerimonias
Terminal=false
Categories=Office;
StartupWMClass=cerimonias
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$LAUNCHER")" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true

# 4. Autostart (opt-in): same format the app writes itself, pointing at the installed AppImage.
if [ "$AUTOSTART" = 1 ]; then
  mkdir -p "$(dirname "$AUTOSTART_FILE")"
  write_if_changed "$AUTOSTART_FILE" 644 <<EOF
[Desktop Entry]
Type=Application
Name=Cerimônias
Comment=Cerimônias por voz, começa só na bandeja
Exec=$APP --hidden
Icon=cerimonias
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
elif [ -f "$AUTOSTART_FILE" ]; then
  if grep -q "^Exec=$APP " "$AUTOSTART_FILE"; then
    say "autostart  already points at the installed app ($AUTOSTART_FILE)"
  else
    say "autostart  $AUTOSTART_FILE does not point at the installed app; run again with --autostart to repoint it"
  fi
else
  say "autostart  not enabled (use --autostart, or Configurações → Início in the app)"
fi

# 5. Heads-up about instances (dev and installed share userData, so only one runs at a time).
if pgrep -f "$APP" >/dev/null 2>&1; then
  say "note       the installed Cerimônias is running; close it and open it again to use the new version."
fi
if pgrep -f "node_modules/electron/dist/electron.*cerimonias" >/dev/null 2>&1; then
  say "note       the dev tree is running; it shares data and the single-instance lock, so close it before opening the installed one."
fi
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
  say "warning    libfuse2 not found: the AppImage may not start (sudo apt install libfuse2t64)."
fi
say "done       open it from the applications menu or run: $APP"
