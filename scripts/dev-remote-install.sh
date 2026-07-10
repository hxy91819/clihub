#!/usr/bin/env bash

set -euo pipefail

VSIX="$1"
EXPECTED_ID="$2"
EXPECTED_VERSION="$3"
shift 3

for command_name in node unzip; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required remote command not found: $command_name" >&2
    exit 1
  fi
done

TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP"
  rm -f "$VSIX"
}
trap cleanup EXIT

unzip -q "$VSIX" -d "$TMP"
MANIFEST="$TMP/extension/package.json"
ACTUAL_ID="$(node -e "const p=require(process.argv[1]); process.stdout.write((p.publisher + '.' + p.name).toLowerCase());" "$MANIFEST")"
ACTUAL_VERSION="$(node -e "const p=require(process.argv[1]); process.stdout.write(p.version);" "$MANIFEST")"

if [ "$ACTUAL_ID" != "$EXPECTED_ID" ] || [ "$ACTUAL_VERSION" != "$EXPECTED_VERSION" ]; then
  echo "Error: remote VSIX metadata mismatch: $ACTUAL_ID@$ACTUAL_VERSION" >&2
  exit 1
fi

for configured_root in "$@"; do
  # Match a literal ~/ prefix supplied as an argument.
  # shellcheck disable=SC2088
  case "$configured_root" in
    "~/"*) server_root="$HOME/${configured_root#"~/"}" ;;
    "~") server_root="$HOME" ;;
    /*) server_root="$configured_root" ;;
    *) server_root="$HOME/$configured_root" ;;
  esac

  extensions_dir="$server_root/extensions"
  target="$extensions_dir/$EXPECTED_ID-$EXPECTED_VERSION"
  staging="$extensions_dir/.$EXPECTED_ID-$EXPECTED_VERSION.tmp.$$"

  mkdir -p "$extensions_dir"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -a "$TMP/extension/." "$staging/"
  rm -rf "$target"
  mv "$staging" "$target"

  find "$extensions_dir" -mindepth 1 -maxdepth 1 -type d -iname "$EXPECTED_ID-*" ! -name "$(basename "$target")" -exec rm -rf {} +
  find "$extensions_dir" -mindepth 1 -maxdepth 1 -type d -iname "clihub.cli-hub-*" -exec rm -rf {} +

  echo "Installed $EXPECTED_ID@$EXPECTED_VERSION into $extensions_dir"
done
