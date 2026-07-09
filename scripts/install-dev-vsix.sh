#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

EDITOR="${CLIHUB_EDITOR:-code}"
REMOTE_HOST="${CLIHUB_REMOTE_HOST:-}"
MAIN_ONLY="${CLIHUB_MAIN_ONLY:-false}"
SKIP_LOCAL="${CLIHUB_SKIP_LOCAL:-false}"
SKIP_REMOTE="${CLIHUB_SKIP_REMOTE:-false}"

case "$EDITOR" in
  code)
    LOCAL_CLI="${CLIHUB_LOCAL_CLI:-/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code}"
    REMOTE_EXTENSIONS_DIR="${CLIHUB_REMOTE_EXTENSIONS_DIR:-~/.vscode-server/extensions}"
    ;;
  cursor)
    LOCAL_CLI="${CLIHUB_LOCAL_CLI:-/Applications/Cursor.app/Contents/Resources/app/bin/cursor}"
    REMOTE_EXTENSIONS_DIR="${CLIHUB_REMOTE_EXTENSIONS_DIR:-~/.cursor-server/extensions}"
    ;;
  *)
    echo "Error: CLIHUB_EDITOR must be 'code' or 'cursor'"
    exit 1
    ;;
esac

if [ ! -x "$LOCAL_CLI" ]; then
  echo "Error: local editor CLI not found or not executable: $LOCAL_CLI"
  exit 1
fi

find_latest_vsix() {
  local pattern="$1"
  find "$ROOT_DIR" -maxdepth 1 -type f -name "$pattern" -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1
}

MAIN_VSIX="${CLIHUB_MAIN_VSIX:-$(find_latest_vsix 'cli-hub-[0-9]*-public.vsix')}"
BRIDGE_VSIX="${CLIHUB_BRIDGE_VSIX:-$(find_latest_vsix 'cli-hub-local-bridge-*-public.vsix')}"

if [ -z "$MAIN_VSIX" ] || [ ! -f "$MAIN_VSIX" ]; then
  echo "Error: main VSIX not found. Run npm run package:dev first."
  exit 1
fi

if [ "$MAIN_ONLY" != "true" ] && { [ -z "$BRIDGE_VSIX" ] || [ ! -f "$BRIDGE_VSIX" ]; }; then
  echo "Error: local bridge VSIX not found. Run npm run package:dev first or set CLIHUB_MAIN_ONLY=true."
  exit 1
fi

read_vsix_field() {
  local vsix="$1"
  local expr="$2"
  unzip -p "$vsix" extension/package.json | node -e "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { const p = JSON.parse(s); console.log($expr); });"
}

read_vsix_id() {
  read_vsix_field "$1" "(p.publisher + '.' + p.name).toLowerCase()"
}

read_vsix_version() {
  read_vsix_field "$1" "p.version"
}

MAIN_ID="$(read_vsix_id "$MAIN_VSIX")"
MAIN_VERSION="$(read_vsix_version "$MAIN_VSIX")"

install_local() {
  echo "Installing local main extension into $EDITOR: $MAIN_ID@$MAIN_VERSION"
  "$LOCAL_CLI" --install-extension "$MAIN_VSIX" --force

  if [ "$MAIN_ONLY" = "true" ]; then
    echo "Ensuring local bridge is not installed in $EDITOR"
    "$LOCAL_CLI" --uninstall-extension masonhuang.cli-hub-local-bridge >/dev/null 2>&1 || true
  else
    local bridge_id
    local bridge_version
    bridge_id="$(read_vsix_id "$BRIDGE_VSIX")"
    bridge_version="$(read_vsix_version "$BRIDGE_VSIX")"
    echo "Installing local bridge extension into $EDITOR: $bridge_id@$bridge_version"
    "$LOCAL_CLI" --install-extension "$BRIDGE_VSIX" --force
  fi

  "$LOCAL_CLI" --uninstall-extension clihub.cli-hub >/dev/null 2>&1 || true

  echo "Local installed versions:"
  "$LOCAL_CLI" --list-extensions --show-versions | grep -E 'masonhuang\.cli-hub(@|-local-bridge@)' || true
}

install_remote_main() {
  if [ -z "$REMOTE_HOST" ]; then
    echo "Remote host not set; skipping remote install. Set CLIHUB_REMOTE_HOST to enable it."
    return
  fi

  local remote_vsix="/tmp/$(basename "$MAIN_VSIX")"
  echo "Copying main VSIX to $REMOTE_HOST:$remote_vsix"
  scp "$MAIN_VSIX" "$REMOTE_HOST:$remote_vsix"

  echo "Installing remote main extension into $REMOTE_HOST:$REMOTE_EXTENSIONS_DIR"
  ssh "$REMOTE_HOST" bash -s -- "$remote_vsix" "$REMOTE_EXTENSIONS_DIR" <<'REMOTE_SCRIPT'
set -euo pipefail

VSIX="$1"
REMOTE_EXTENSIONS_DIR="$2"

case "$REMOTE_EXTENSIONS_DIR" in
  "~/"*) REMOTE_EXTENSIONS_DIR="$HOME/${REMOTE_EXTENSIONS_DIR#"~/"}" ;;
  "~") REMOTE_EXTENSIONS_DIR="$HOME" ;;
esac

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

unzip -q "$VSIX" -d "$TMP"
MANIFEST="$TMP/extension/package.json"
EXT_ID="$(node -e "const p=require('$MANIFEST'); process.stdout.write((p.publisher + '.' + p.name).toLowerCase());")"
VERSION="$(node -e "const p=require('$MANIFEST'); process.stdout.write(p.version);")"
TARGET="$REMOTE_EXTENSIONS_DIR/$EXT_ID-$VERSION"

mkdir -p "$REMOTE_EXTENSIONS_DIR"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -a "$TMP/extension/." "$TARGET/"

find "$REMOTE_EXTENSIONS_DIR" -maxdepth 1 -type d -name "$EXT_ID-*" ! -name "$(basename "$TARGET")" -exec rm -rf {} +
find "$REMOTE_EXTENSIONS_DIR" -maxdepth 1 -type d -name "clihub.cli-hub-*" -exec rm -rf {} +

node -e "const p=require('$TARGET/package.json'); console.log((p.publisher + '.' + p.name).toLowerCase() + '@' + p.version);"
REMOTE_SCRIPT
}

if [ "$SKIP_LOCAL" != "true" ]; then
  install_local
fi

if [ "$SKIP_REMOTE" != "true" ]; then
  install_remote_main
fi
