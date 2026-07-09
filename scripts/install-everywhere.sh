#!/bin/bash

set -euo pipefail

# Quick start examples:
#   1) One command for local + remote (default remote: dev-server):
#      npm run install:everywhere
#      bash ./scripts/install-everywhere.sh
#   2) One command for local + a specific remote host:
#      bash ./scripts/install-everywhere.sh --remote dev-server
#   3) One command with an explicit VSIX path:
#      bash ./scripts/install-everywhere.sh \
#        --remote dev-server \
#        --vsix /absolute/path/to/cli-hub-1.4.4-internal.vsix
#   4) Install only on one side when needed:
#      bash ./scripts/install-everywhere.sh --local-only
#      bash ./scripts/install-everywhere.sh --remote-only --remote dev-server
#
# What this script installs:
#   - Codebuddy CLI on local and remote
#   - CLI Hub VSIX into configured local VS Code-like IDEs (default: VS Code)
#   - CLI Hub VSIX into configured remote VS Code-like server roots (default: VS Code Server)
#
# Safety:
#   - When no --vsix is provided, this script prefers the newest internal VSIX.
#   - If a newer VSIX exists in the repo root, the script aborts to avoid silently
#     installing a stale internal build.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_REMOTE_HOST="${CLIHUB_REMOTE_HOST:-dev-server}"
REMOTE_HOST="$DEFAULT_REMOTE_HOST"
VSIX_PATH="${CLIHUB_VSIX_PATH:-}"
LOCAL_EDITOR_TARGETS="${CLIHUB_LOCAL_EDITOR_TARGETS:-code=VS Code}"
REMOTE_SERVER_TARGETS="${CLIHUB_REMOTE_SERVER_TARGETS:-.vscode-server}"
INSTALL_LOCAL=true
INSTALL_REMOTE=true

usage() {
  cat <<EOF
One-click installer for CLI Hub + Codebuddy on local and remote.

Usage:
  bash ./scripts/install-everywhere.sh [options]

Options:
  --remote <host>     SSH host alias to install on. Default: ${DEFAULT_REMOTE_HOST}
  --vsix <path>       VSIX path to install. Defaults to newest internal VSIX in repo root.
  --local-editors <list>
                      Comma-separated local IDE CLI targets. Default: ${LOCAL_EDITOR_TARGETS}
                      Format: cli or cli=Display Name
  --remote-server-roots <list>
                      Comma-separated remote VS Code-like server roots. Default: ${REMOTE_SERVER_TARGETS}
                      Relative values are resolved from the remote home directory.
  --local-only        Install only on the local machine.
  --remote-only       Install only on the remote SSH host.
  -h, --help          Show this help message.

Examples:
  bash ./scripts/install-everywhere.sh
  bash ./scripts/install-everywhere.sh --remote dev-server
  bash ./scripts/install-everywhere.sh --vsix ./cli-hub-1.4.4-internal.vsix
  bash ./scripts/install-everywhere.sh --local-editors "code=VS Code,cursor=Cursor"
  CLIHUB_REMOTE_SERVER_TARGETS=".vscode-server,.cursor-server" bash ./scripts/install-everywhere.sh
EOF
}

log() {
  printf '\n==> %s\n' "$1"
}

warn() {
  printf 'Warning: %s\n' "$1" >&2
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command not found: $command_name" >&2
    exit 1
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

shell_quote() {
  printf '%q' "$1"
}

resolve_vsix_path() {
  if [ -n "$VSIX_PATH" ]; then
    python3 - <<'PY' "$VSIX_PATH"
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
    return
  fi

  python3 - <<'PY' "$REPO_ROOT"
import glob
import os
import sys

repo_root = sys.argv[1]
internal_matches = glob.glob(os.path.join(repo_root, "cli-hub-*-internal.vsix"))
all_matches = glob.glob(os.path.join(repo_root, "cli-hub-*.vsix"))

if not all_matches:
    sys.exit(1)

latest_any = max(all_matches, key=os.path.getmtime)

if not internal_matches:
    print(latest_any)
    sys.exit(0)

latest_internal = max(internal_matches, key=os.path.getmtime)

if os.path.abspath(latest_any) != os.path.abspath(latest_internal) and os.path.getmtime(latest_any) > os.path.getmtime(latest_internal):
    print(
        "Error: newest internal VSIX is older than the newest available VSIX. "
        "Rebuild the internal package or pass --vsix explicitly.",
        file=sys.stderr,
    )
    print(f"Internal candidate: {latest_internal}", file=sys.stderr)
    print(f"Newest VSIX: {latest_any}", file=sys.stderr)
    sys.exit(2)

print(latest_internal)
PY
}

install_local_codebuddy() {
  log "Installing Codebuddy CLI locally"
  require_command npm
  npm install -g @tencent-ai/codebuddy-code
  command -v codebuddy >/dev/null 2>&1 && codebuddy --version || true
}

install_local_extension() {
  local editor_cli="$1"
  local display_name="$2"

  if ! command -v "$editor_cli" >/dev/null 2>&1; then
    warn "$display_name CLI not found, skipping local extension install"
    return
  fi

  log "Installing CLI Hub VSIX into local $display_name"
  "$editor_cli" --install-extension "$VSIX_PATH" --force
}

install_local_extensions() {
  local target
  local editor_cli
  local display_name

  IFS=',' read -r -a targets <<< "$LOCAL_EDITOR_TARGETS"
  for target in "${targets[@]}"; do
    target="$(trim "$target")"
    if [ -z "$target" ]; then
      continue
    fi

    if [[ "$target" == *"="* ]]; then
      editor_cli="$(trim "${target%%=*}")"
      display_name="$(trim "${target#*=}")"
    else
      editor_cli="$target"
      display_name="$target"
    fi

    if [ -z "$editor_cli" ]; then
      warn "Ignoring empty local editor target: $target"
      continue
    fi
    if [ -z "$display_name" ]; then
      display_name="$editor_cli"
    fi

    install_local_extension "$editor_cli" "$display_name"
  done
}

install_remote_codebuddy() {
  log "Installing Codebuddy CLI on remote host: $REMOTE_HOST"
  ssh "$REMOTE_HOST" 'set -euo pipefail; command -v npm >/dev/null 2>&1; npm install -g @tencent-ai/codebuddy-code; command -v codebuddy >/dev/null 2>&1 && codebuddy --version || true'
}

install_remote_extensions() {
  local remote_vsix="/tmp/$(basename "$VSIX_PATH").$$"
  local remote_server_targets_quoted

  remote_server_targets_quoted="$(shell_quote "$REMOTE_SERVER_TARGETS")"

  log "Copying VSIX to remote host: $REMOTE_HOST"
  scp "$VSIX_PATH" "$REMOTE_HOST:$remote_vsix"

  log "Installing CLI Hub VSIX into remote editor servers"
  ssh "$REMOTE_HOST" "set -euo pipefail
VSIX_PATH='$remote_vsix'
REMOTE_SERVER_TARGETS=$remote_server_targets_quoted

install_server_extension() {
  local server_root=\"\$1\"
  local extensions_dir=\"\$server_root/extensions\"
  local temp_dir
  local package_json
  local publisher
  local extension_name
  local version
  local target_dir

  mkdir -p \"\$extensions_dir\"

  temp_dir=\$(mktemp -d)
  unzip -q -o \"\$VSIX_PATH\" -d \"\$temp_dir\"
  package_json=\"\$temp_dir/extension/package.json\"

  publisher=\$(node -p \"require('\$package_json').publisher\")
  extension_name=\$(node -p \"require('\$package_json').name\")
  version=\$(node -p \"require('\$package_json').version\")
  target_dir=\"\$extensions_dir/\${publisher}.\${extension_name}-\${version}\"

  rm -rf \"\$target_dir\"
  mv \"\$temp_dir/extension\" \"\$target_dir\"
  find \"\$extensions_dir\" -mindepth 1 -maxdepth 1 -type d -name \"\${publisher}.\${extension_name}-*\" ! -name \"\${publisher}.\${extension_name}-\${version}\" -exec rm -rf {} +
  rm -rf \"\$temp_dir\"

  echo \"Installed \${publisher}.\${extension_name}@\${version} into \$extensions_dir\"
}

trim_remote_value() {
  local value=\"\$1\"
  value=\"\${value#\"\${value%%[![:space:]]*}\"}\"
  value=\"\${value%\"\${value##*[![:space:]]}\"}\"
  printf '%s' \"\$value\"
}

declare -a server_roots=()
IFS=',' read -r -a configured_roots <<< \"\$REMOTE_SERVER_TARGETS\"
for configured_root in \"\${configured_roots[@]}\"; do
  configured_root=\$(trim_remote_value \"\$configured_root\")
  if [ -z \"\$configured_root\" ]; then
    continue
  fi

  if [[ \"\$configured_root\" = /* ]]; then
    root_pattern=\"\$configured_root\"
  else
    root_pattern=\"\$HOME/\$configured_root\"
  fi

  shopt -s nullglob
  matched_roots=(\$root_pattern)
  shopt -u nullglob

  if [ \"\${#matched_roots[@]}\" -eq 0 ]; then
    server_roots+=(\"\$root_pattern\")
  else
    for matched_root in \"\${matched_roots[@]}\"; do
      server_roots+=(\"\$matched_root\")
    done
  fi
done

for server_root in \"\${server_roots[@]}\"; do
  install_server_extension \"\$server_root\"
done

rm -f \"\$VSIX_PATH\""
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote)
      if [ "$#" -lt 2 ]; then
        echo "Error: --remote requires a host value" >&2
        exit 1
      fi
      REMOTE_HOST="$2"
      shift 2
      ;;
    --vsix)
      if [ "$#" -lt 2 ]; then
        echo "Error: --vsix requires a file path" >&2
        exit 1
      fi
      VSIX_PATH="$2"
      shift 2
      ;;
    --local-editors)
      if [ "$#" -lt 2 ]; then
        echo "Error: --local-editors requires a target list" >&2
        exit 1
      fi
      LOCAL_EDITOR_TARGETS="$2"
      shift 2
      ;;
    --remote-server-roots)
      if [ "$#" -lt 2 ]; then
        echo "Error: --remote-server-roots requires a root list" >&2
        exit 1
      fi
      REMOTE_SERVER_TARGETS="$2"
      shift 2
      ;;
    --local-only)
      INSTALL_REMOTE=false
      shift
      ;;
    --remote-only)
      INSTALL_LOCAL=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_command python3

VSIX_PATH="$(resolve_vsix_path)" || {
  echo "Error: unable to locate a VSIX. Pass one with --vsix." >&2
  exit 1
}

if [ ! -f "$VSIX_PATH" ]; then
  echo "Error: VSIX file not found: $VSIX_PATH" >&2
  exit 1
fi

log "Using VSIX: $VSIX_PATH"

if [ "$INSTALL_LOCAL" = true ]; then
  install_local_codebuddy
  install_local_extensions
fi

if [ "$INSTALL_REMOTE" = true ]; then
  require_command ssh
  require_command scp
  install_remote_codebuddy
  install_remote_extensions
fi

log "All requested installations finished"
