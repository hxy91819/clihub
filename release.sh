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

# 中文注释: 检查输入参数是否合法
if [ "$#" -lt 1 ]; then
    echo "Usage: ./release.sh <new_version> [--force] [--channel public|internal] [--tool-manifest /path/to/manifest.json]"  # 日志使用英文
    exit 1
fi

NEW_VERSION="$1"
FORCE=false
CHANNEL="public"
TOOL_MANIFEST_PATH=""

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

cleanup() {
    if [ "$ORIGINAL_MANIFEST_PRESENT" = true ]; then
        cp "$BACKUP_MANIFEST" "$ACTIVE_MANIFEST"
        rm -f "$BACKUP_MANIFEST"
    else
        rm -f "$ACTIVE_MANIFEST"
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

echo "Target version: ${NEW_VERSION}"
echo "Release channel: ${CHANNEL}"

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
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
if [ "$CURRENT_VERSION" != "$NEW_VERSION" ]; then
    npm version "$NEW_VERSION" --no-git-tag-version >/dev/null
    echo "package.json and package-lock.json updated"
else
    echo "Skipping version update (same version)"
fi

# 中文注释: 更新README中的版本信息（如果存在版本引用）
python3 <<PY
import pathlib
import re
import sys

root = pathlib.Path('$SCRIPT_DIR')
readme_path = root / 'README.md'
text = readme_path.read_text(encoding='utf-8')

# 查找并更新 .vsix 文件名中的版本号
pattern = r"cli-hub-[0-9]+\.[0-9]+\.[0-9]+\.vsix"
replacement = f"cli-hub-{ '$NEW_VERSION' }.vsix"
if re.search(pattern, text):
    readme_path.write_text(re.sub(pattern, replacement, text), encoding='utf-8')
    print("README.md updated with new version")
else:
    print("No version references found in README.md to update")
PY

# 中文注释: 重新编译扩展
npm run compile

echo "Build finished"

# 中文注释: 发布前再次强制编译
npm run compile

# 中文注释: 打包VSCode扩展 (自动安装vsce)
PACKAGE_NAME="cli-hub-${NEW_VERSION}-${CHANNEL}.vsix"
npx --yes vsce package --out "$PACKAGE_NAME"

echo "Release package generated"

# 中文注释: 复制VSIX文件到部署目录
VSIX_FILE="$PACKAGE_NAME"
if [ -n "${VSIX_DEPLOY_PATH:-}" ]; then
    if [ -f "$VSIX_FILE" ]; then
        # 创建目标目录（如果不存在）
        mkdir -p "$VSIX_DEPLOY_PATH"
        # 复制文件
        cp "$VSIX_FILE" "$VSIX_DEPLOY_PATH/"
        echo "VSIX file copied to: $VSIX_DEPLOY_PATH/$VSIX_FILE"
    else
        echo "Error: VSIX file $VSIX_FILE not found"
        exit 1
    fi
else
    echo "Warning: VSIX_DEPLOY_PATH not set, skipping file copy"
fi
