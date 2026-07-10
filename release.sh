#!/bin/bash

set -euo pipefail

# Quick start examples:
#   1) Rebuild current public package:
#      bash ./release.sh 1.4.3 --force --channel public
#   2) Rebuild current internal package:
#      bash ./release.sh 1.4.3 --force --channel internal \
#        --tool-manifest /absolute/path/to/tool-manifest.internal.json
#   3) Build a new version for public release:
#      bash ./release.sh 1.4.4 --channel public
#   4) Build a new version for internal release:
#      bash ./release.sh 1.4.4 --channel internal \
#        --tool-manifest /absolute/path/to/tool-manifest.internal.json
#   5) Build local development packages with a visible dev version:
#      bash ./release.sh 1.4.7 --force --channel public --dev-build
#      bash ./release.sh 1.4.7 --force --channel public --dev-build bridge-test
#      CLIHUB_DEV_BUILD_LABEL=bridge-test bash ./release.sh 1.4.7 --force --channel public --dev-build
#      # Produces packages like 1.4.8-dev.20260709185312 so VS Code treats them as newer than 1.4.7.
#
# Notes:
#   - Run from the repository root.
#   - Internal builds must provide --tool-manifest.
#   - Use --force only when rebuilding the same version.

# 中文注释: 该脚本用于自动更新版本号并打包VSCode插件

# 中文注释: 使用反例（不要这样用）
# 0) 不传参数，误以为会自动调整版本号（实际会直接输出 Usage 并退出）:
#    ./release.sh
# 1) 用 sh 执行（会导致 bash 语法/变量不兼容）:
#    sh ./release.sh 0.1.0
# 2) 传入非语义化版本号（会直接报错退出）:
#    ./release.sh v0.1.0
#    ./release.sh 0.1
# 3) 目标版本与当前版本相同但未显式 --force（会报错退出）:
#    ./release.sh 0.1.0
# 4) 误以为该脚本会发布到 VS Code Marketplace（它只会 compile + vsce package 生成 .vsix）
# 5) 用 --dev-build 做正式发布（开发版本号仅用于本地调试包）

# 中文注释: 检查输入参数是否合法
if [ "$#" -lt 1 ]; then
    echo "Usage: ./release.sh <new_version> [--force] [--channel public|internal] [--tool-manifest /path/to/manifest.json] [--dev-build [label]]"  # 日志使用英文
    exit 1
fi

NEW_VERSION="$1"
FORCE=false
CHANNEL="public"
TOOL_MANIFEST_PATH=""
DEV_BUILD=false
DEV_LABEL=""

shift

while [ "$#" -gt 0 ]; do
    case "$1" in
        --force)
            FORCE=true
            shift
            ;;
        --channel)
            if [ "$#" -lt 2 ]; then
                echo "Error: --channel requires a value (public or internal)"
                exit 1
            fi
            CHANNEL="$2"
            shift 2
            ;;
        --tool-manifest)
            if [ "$#" -lt 2 ]; then
                echo "Error: --tool-manifest requires a file path"
                exit 1
            fi
            TOOL_MANIFEST_PATH="$2"
            shift 2
            ;;
        --dev-build)
            DEV_BUILD=true
            if [ "$#" -ge 2 ] && [[ ! "$2" =~ ^-- ]]; then
                DEV_LABEL="$2"
                shift 2
            else
                shift
            fi
            ;;
        *)
            echo "Error: unknown argument: $1"
            exit 1
            ;;
    esac
done

if [ "$CHANNEL" != "public" ] && [ "$CHANNEL" != "internal" ]; then
    echo "Error: channel must be 'public' or 'internal'"
    exit 1
fi

# 中文注释: 校验语义化版本格式
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must follow semantic versioning (e.g. 0.1.0)"
    exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

PACKAGE_JSON="$SCRIPT_DIR/package.json"
PACKAGE_LOCK="$SCRIPT_DIR/package-lock.json"
BRIDGE_PACKAGE_JSON="$SCRIPT_DIR/extensions/local-bridge/package.json"
PUBLIC_MANIFEST="$SCRIPT_DIR/config/tool-manifest.public.json"
ACTIVE_MANIFEST="$SCRIPT_DIR/config/tool-manifest.json"

if [ ! -f "$PUBLIC_MANIFEST" ]; then
    echo "Error: public tool manifest not found: $PUBLIC_MANIFEST"
    exit 1
fi

if [ "$CHANNEL" = "internal" ]; then
    if [ -z "$TOOL_MANIFEST_PATH" ]; then
        echo "Error: internal channel requires --tool-manifest /path/to/manifest.json"
        exit 1
    fi
    if [ ! -f "$TOOL_MANIFEST_PATH" ]; then
        echo "Error: tool manifest not found: $TOOL_MANIFEST_PATH"
        exit 1
    fi
else
    TOOL_MANIFEST_PATH="$PUBLIC_MANIFEST"
fi

ORIGINAL_MANIFEST_PRESENT=false
BACKUP_MANIFEST=""
if [ -f "$ACTIVE_MANIFEST" ]; then
    ORIGINAL_MANIFEST_PRESENT=true
    BACKUP_MANIFEST="$(mktemp)"
    cp "$ACTIVE_MANIFEST" "$BACKUP_MANIFEST"
fi

BACKUP_PACKAGE_JSON=""
BACKUP_PACKAGE_LOCK=""
BACKUP_BRIDGE_PACKAGE_JSON=""
if [ "$DEV_BUILD" = true ]; then
    BACKUP_PACKAGE_JSON="$(mktemp)"
    BACKUP_PACKAGE_LOCK="$(mktemp)"
    BACKUP_BRIDGE_PACKAGE_JSON="$(mktemp)"
    cp "$PACKAGE_JSON" "$BACKUP_PACKAGE_JSON"
    cp "$PACKAGE_LOCK" "$BACKUP_PACKAGE_LOCK"
    cp "$BRIDGE_PACKAGE_JSON" "$BACKUP_BRIDGE_PACKAGE_JSON"
fi

cleanup() {
    if [ "$ORIGINAL_MANIFEST_PRESENT" = true ]; then
        cp "$BACKUP_MANIFEST" "$ACTIVE_MANIFEST"
        rm -f "$BACKUP_MANIFEST"
    else
        rm -f "$ACTIVE_MANIFEST"
    fi

    if [ "$DEV_BUILD" = true ]; then
        cp "$BACKUP_PACKAGE_JSON" "$PACKAGE_JSON"
        cp "$BACKUP_PACKAGE_LOCK" "$PACKAGE_LOCK"
        cp "$BACKUP_BRIDGE_PACKAGE_JSON" "$BRIDGE_PACKAGE_JSON"
        rm -f "$BACKUP_PACKAGE_JSON" "$BACKUP_PACKAGE_LOCK" "$BACKUP_BRIDGE_PACKAGE_JSON"
    fi
}

trap cleanup EXIT

# 中文注释: 加载.env文件中的环境变量
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
    echo "Loaded environment variables from .env"
else
    echo "Warning: .env file not found"
fi

# 中文注释: 读取当前版本
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo "Current version: ${CURRENT_VERSION}"

PACKAGE_VERSION="$NEW_VERSION"
if [ "$DEV_BUILD" = true ]; then
    if [ -z "$DEV_LABEL" ] && [ -n "${CLIHUB_DEV_BUILD_LABEL:-}" ]; then
        DEV_LABEL="$CLIHUB_DEV_BUILD_LABEL"
    fi
    if [ -z "$DEV_LABEL" ]; then
        DEV_LABEL="$(date +%Y%m%d%H%M%S)"
    fi
    DEV_LABEL="$(printf '%s' "$DEV_LABEL" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^0-9a-z-]+/-/g; s/^-+//; s/-+$//')"
    if [ -z "$DEV_LABEL" ]; then
        echo "Error: --dev-build label must contain at least one alphanumeric character"
        exit 1
    fi
    DEV_BASE_VERSION="$(node - <<NODE
const semver = require('semver');
const next = semver.inc('$NEW_VERSION', 'patch');
if (!next) {
  process.exit(1);
}
process.stdout.write(next);
NODE
)"
    PACKAGE_VERSION="${DEV_BASE_VERSION}-dev.${DEV_LABEL}"
fi

echo "Target version: ${NEW_VERSION}"
echo "Package version: ${PACKAGE_VERSION}"
echo "Release channel: ${CHANNEL}"
if [ "$DEV_BUILD" = true ]; then
    echo "Development build: true"
fi

if [ "$DEV_BUILD" = false ] && [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
    if [ "$FORCE" = false ]; then
        echo "Error: new version equals current version. Use --force to override."
        exit 1
    else
        echo "Force mode enabled, overriding same version"
    fi
fi

RESOLVED_TOOL_MANIFEST_PATH="$(python3 - <<'PY' "$TOOL_MANIFEST_PATH"
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
)"
RESOLVED_ACTIVE_MANIFEST_PATH="$(python3 - <<'PY' "$ACTIVE_MANIFEST"
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
)"

if [ "$RESOLVED_TOOL_MANIFEST_PATH" != "$RESOLVED_ACTIVE_MANIFEST_PATH" ]; then
    cp "$TOOL_MANIFEST_PATH" "$ACTIVE_MANIFEST"
    echo "Active tool manifest prepared from: $TOOL_MANIFEST_PATH"
else
    echo "Active tool manifest already in place: $TOOL_MANIFEST_PATH"
fi

# 中文注释: 使用npm更新package.json和package-lock.json中的版本号
if [ "$DEV_BUILD" = true ]; then
    npm version "$PACKAGE_VERSION" --no-git-tag-version >/dev/null
    echo "package.json and package-lock.json updated for development build"
elif [ "$CURRENT_VERSION" != "$NEW_VERSION" ]; then
    npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
    echo "package.json and package-lock.json updated"
else
    echo "Skipping version update (same version)"
fi

node <<NODE
const fs = require('fs');
const path = require('path');
const bridgePackagePath = path.join('$SCRIPT_DIR', 'extensions', 'local-bridge', 'package.json');
const bridgePackage = JSON.parse(fs.readFileSync(bridgePackagePath, 'utf8'));
bridgePackage.version = '$PACKAGE_VERSION';
fs.writeFileSync(bridgePackagePath, JSON.stringify(bridgePackage, null, 2) + '\n');
console.log('Local Bridge package.json updated');
NODE

# 中文注释: 打包前校验双插件版本、publisher、图标、市场 README 和 release workflow 约束
npm run validate:release

# 中文注释: 打包前编译扩展
npm run compile

echo "Build finished"

# 中文注释: 打包VSCode扩展 (自动安装vsce)
PACKAGE_NAME="cli-hub-${PACKAGE_VERSION}-${CHANNEL}.vsix"
npx --yes vsce package --out "$PACKAGE_NAME"

BRIDGE_PACKAGE_NAME="cli-hub-local-bridge-${PACKAGE_VERSION}-${CHANNEL}.vsix"
(
    cd "$SCRIPT_DIR/extensions/local-bridge"
    npx --yes vsce package --out "$SCRIPT_DIR/$BRIDGE_PACKAGE_NAME"
)

node ./scripts/validate-vsix-contents.js "$PACKAGE_NAME" "$BRIDGE_PACKAGE_NAME"

echo "Release packages generated"

# 中文注释: 复制VSIX文件到部署目录
if [ -n "${VSIX_DEPLOY_PATH:-}" ]; then
    # 创建目标目录（如果不存在）
    mkdir -p "$VSIX_DEPLOY_PATH"
    for VSIX_FILE in "$PACKAGE_NAME" "$BRIDGE_PACKAGE_NAME"; do
        if [ -f "$VSIX_FILE" ]; then
            # 复制文件
            cp "$VSIX_FILE" "$VSIX_DEPLOY_PATH/"
            echo "VSIX file copied to: $VSIX_DEPLOY_PATH/$VSIX_FILE"
        else
            echo "Error: VSIX file $VSIX_FILE not found"
            exit 1
        fi
    done
else
    echo "Warning: VSIX_DEPLOY_PATH not set, skipping file copy"
fi
