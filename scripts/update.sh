#!/usr/bin/env bash
# Rebuilds Cerimônias from this source tree and replaces the installed app, in one step.
#
#   scripts/update.sh [--no-build] [--force-dirty] [--kill] [--timeout <s>] [--hidden] [--no-start]
#
#   --no-build      reuse the newest dist/*.AppImage instead of running npm run dist
#   --force-dirty   build even with uncommitted changes in src/ (the build is stamped +dirty)
#   --kill          if the running app does not quit by itself in time, SIGTERM it (SIGKILL after 10 s)
#   --timeout <s>   how long to wait for the running app to quit (default 45)
#   --hidden        start the new app in the tray only
#   --no-start      install but do not start it
#
# Order: check the tree, build (the installed app is untouched if this fails), ask the running app to quit
# (it saves its state first), wait for it to be gone, install, start the new one detached.
# Honours CERIMONIAS_PREFIX, XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_STATE_HOME and CERIMONIAS_DATA_DIR, so a
# test install in a scratch directory never touches the real one; CERIMONIAS_APP_ARGS adds arguments to every
# launch of the app (for example --user-data-dir=...).
# Log: $XDG_STATE_HOME/cerimonias/update.log (default ~/.local/state/cerimonias/update.log).
set -euo pipefail

# Started from inside the app, this script inherits its AppImage variables: they would make the running
# instance look like part of this process, and the new one would inherit a mount that is going away.
unset APPIMAGE APPDIR ARGV0 OWD

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFIX="${CERIMONIAS_PREFIX:-$HOME/.local/opt/cerimonias}"
APP="$PREFIX/cerimonias.AppImage"
DATA_ROOT="${CERIMONIAS_DATA_DIR:-$HOME/.local/share/cerimonias}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/cerimonias"
LOG="$STATE/update.log"
BUILD_LOG="$STATE/build.log"
APP_LOG="$STATE/app.log"
MARKER="$STATE/updated.json"
RUN_FILE="$DATA_ROOT/run.json"
QUIT_FLAG="--quit-for-update"
# shellcheck disable=SC2206
APP_ARGS=(${CERIMONIAS_APP_ARGS:-})

BUILD=1
FORCE_DIRTY=0
KILL=0
HIDDEN=0
START=1
TIMEOUT=45

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --force-dirty) FORCE_DIRTY=1 ;;
    --kill) KILL=1 ;;
    --hidden) HIDDEN=1 ;;
    --no-start) START=0 ;;
    --timeout) TIMEOUT="${2:?--timeout precisa de um número de segundos}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "opção desconhecida: $1 (veja --help)" >&2; exit 2 ;;
  esac
  shift
done
case "$TIMEOUT" in ''|*[!0-9]*) echo "--timeout precisa de um número de segundos" >&2; exit 2 ;; esac

mkdir -p "$STATE"
exec 9>"$STATE/update.lock"
if ! flock -n 9; then
  echo "Já existe uma atualização em andamento (acompanhe em $LOG)." | tee -a "$LOG" >&2
  exit 5
fi

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "erro: $*"; exit "${2:-1}"; }

# PIDs of the app started from $APP: every process of the instance carries APPIMAGE in its environment,
# and the AppImage runtime that holds the mount is the one whose argv[0] is the file itself.
instance_pids() {
  {
    grep -lazxF "APPIMAGE=$APP" /proc/[0-9]*/environ 2>/dev/null | sed 's|/proc/\([0-9]*\)/environ|\1|' || true
    local f first
    for f in $(grep -laz -- "$APP" /proc/[0-9]*/cmdline 2>/dev/null | sed 's|/proc/\([0-9]*\)/cmdline|\1|' || true); do
      # the process may be gone by now: the 2>/dev/null goes first so the failed redirect stays quiet
      first="$(tr '\0' '\n' 2>/dev/null < "/proc/$f/cmdline" | head -n 1 || true)"
      [ "$first" = "$APP" ] && echo "$f"
    done
  } | sort -un | grep -vx "$$" || true
}

wait_gone() { # wait_gone <seconds>
  local deadline=$((SECONDS + $1)) next=$((SECONDS + 5))
  while [ -n "$(instance_pids)" ]; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    if [ "$SECONDS" -ge "$next" ]; then log "esperando o app fechar…"; next=$((SECONDS + 5)); fi
    sleep 0.5
  done
}

ensure_npm() {
  command -v npm >/dev/null 2>&1 && return 0
  # Started from the app or a login entry, PATH has no nvm.
  local nvm="${NVM_DIR:-$HOME/.nvm}/versions/node" bin
  bin="$(ls -d "$nvm"/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  [ -n "$bin" ] && PATH="$bin:$PATH"
  command -v npm >/dev/null 2>&1 || die "não achei o npm (PATH sem node; tentei $nvm)."
}

start_app() {
  rm -f "$RUN_FILE"
  local extra=()
  [ "$HIDDEN" = 1 ] && extra=(--hidden)
  # The lock descriptor is closed so the app does not hold the update lock.
  (cd "$HOME" && setsid -f nohup "$APP" "${APP_ARGS[@]}" "${extra[@]}" >>"$APP_LOG" 2>&1 </dev/null 9>&-)
}

run_field() { sed -n "s/^ *\"$1\": *\"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}$/\1/p" "$RUN_FILE" | head -n 1; }

STARTED=0
QUIT_DONE=0
cleanup() {
  local status=$?
  # The old app was closed but the new one never opened: do not leave the person without an app.
  if [ "$status" -ne 0 ] && [ "$QUIT_DONE" = 1 ] && [ "$STARTED" = 0 ] && [ "$START" = 1 ] && [ -x "$APP" ]; then
    log "reabrindo o app instalado, já que a atualização não terminou"
    start_app || true
  fi
}

run_update() {
  local t0=$SECONDS
  trap cleanup EXIT
  log "atualizando a partir de $ROOT"

  # 1. The source tree
  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$ROOT não é um repositório git."
  local commit branch dirty
  commit="$(git -C "$ROOT" rev-parse --short HEAD)"
  branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
  log "árvore: $branch @ $commit"
  [ "$branch" = "main" ] || log "aviso: a árvore está em '$branch', não na main."
  if [ "$BUILD" = 1 ]; then
    dirty="$(git -C "$ROOT" status --porcelain -- src)"
    if [ -n "$dirty" ] && [ "$FORCE_DIRTY" = 0 ]; then
      log "há alterações não commitadas em src/:"
      printf '%s\n' "$dirty"
      die "commite ou guarde as alterações, ou rode com --force-dirty (o build sai marcado +dirty)."
    fi
    [ -n "$dirty" ] && log "aviso: compilando com alterações não commitadas em src/ (--force-dirty)."
  fi

  # 2. Build: a failure here leaves the installed app untouched.
  local artifact started_at=$(date +%s)
  if [ "$BUILD" = 1 ]; then
    ensure_npm
    log "compilando com npm run dist (log completo em $BUILD_LOG); leva alguns minutos"
    if ! (cd "$ROOT" && npm run dist) >"$BUILD_LOG" 2>&1; then
      log "a compilação falhou; o app instalado não foi tocado. Final do log:"
      tail -n 30 "$BUILD_LOG"
      exit 1
    fi
    log "compilação pronta em $((SECONDS - t0))s"
  fi
  artifact="$(ls -t "$ROOT"/dist/*.AppImage 2>/dev/null | head -n 1 || true)"
  [ -n "$artifact" ] || die "não há dist/*.AppImage; rode sem --no-build."
  if [ "$BUILD" = 1 ] && [ "$(stat -c %Y "$artifact")" -lt "$started_at" ]; then
    die "a compilação terminou sem gerar um AppImage novo ($artifact é anterior ao início)."
  fi
  [ "$BUILD" = 0 ] && log "reusando $artifact (de $(date -d "@$(stat -c %Y "$artifact")" '+%d/%m/%Y %H:%M'))"

  # 3. Ask the running app to quit and wait until it is gone
  if [ -n "$(instance_pids)" ]; then
    log "app em execução: pedindo que feche (ele salva o estado antes)"
    QUIT_DONE=1
    if [ -x "$APP" ]; then
      timeout 30 "$APP" "${APP_ARGS[@]}" "$QUIT_FLAG" >>"$APP_LOG" 2>&1 || true
    fi
    if ! wait_gone "$TIMEOUT"; then
      if [ "$KILL" = 1 ]; then
        log "o app não fechou em ${TIMEOUT}s; --kill: enviando SIGTERM"
        # shellcheck disable=SC2046
        kill -TERM $(instance_pids) 2>/dev/null || true
        if ! wait_gone 10; then
          log "ainda vivo depois de 10s; enviando SIGKILL"
          # shellcheck disable=SC2046
          kill -KILL $(instance_pids) 2>/dev/null || true
          wait_gone 5 || die "não consegui encerrar o app (PIDs: $(instance_pids | tr '\n' ' '))."
        fi
      else
        QUIT_DONE=0
        die "o app não fechou em ${TIMEOUT}s e não foi encerrado à força. Se a versão instalada é anterior a $QUIT_FLAG, feche-a pela bandeja (Sair) e rode de novo com --no-build; ou use --kill. Nada foi instalado." 3
      fi
    fi
    log "app fechado"
  else
    log "o app não está em execução"
  fi

  # 4. Install (autostart is left as it is: no --autostart)
  log "instalando em $PREFIX"
  CERIMONIAS_PREFIX="$PREFIX" "$ROOT/scripts/install-local.sh" --artifact "$artifact" | sed 's/^/    /'
  printf '{"commit":"%s","at":"%s"}\n' "$commit" "$(date -Is)" > "$MARKER"

  # 5. Start the new one
  if [ "$START" = 0 ]; then
    log "pronto; não iniciei o app (--no-start)."
    return 0
  fi
  log "iniciando o app novo (log em $APP_LOG)"
  start_app
  local i pid
  for i in $(seq 1 80); do
    if [ -f "$RUN_FILE" ]; then
      pid="$(run_field pid)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        STARTED=1
        log "instalado e rodando: versão $(run_field version), commit $(run_field commit), compilado em $(run_field builtAt) (pid $pid)"
        log "atualização concluída em $((SECONDS - t0))s"
        return 0
      fi
    fi
    sleep 0.5
  done
  STARTED=1
  die "o app novo foi instalado, mas não confirmou que abriu em 40s; veja $APP_LOG." 4
}

# A pipeline runs run_update in a subshell: its state and its EXIT trap live there.
run_update 2>&1 | tee "$LOG"
exit "${PIPESTATUS[0]}"
