# 开发与发布

本文档面向 CLI Hub 维护者，记录本地开发、测试安装、工具清单扩展和发布流程。扩展市场展示的根目录 `README.md` / `README.zh-CN.md` 只维护用户使用说明。

## 本地开发

```bash
npm install
npm run compile
npm test
```

日常调试使用 VS Code 的 `Run Extension` / `F5` 启动 Extension Development Host。`out/` 是 TypeScript 编译产物，不直接修改。

## 添加工具

1. 编辑 `config/tool-manifest.public.json`，添加包含 `id`、`label`、`description`、`command` 的工具条目，必要时增加 `packageName` 或 `installCommand`。
2. 非公开工具清单通过 release 流程的 `--tool-manifest` 参数在构建时注入，不提交到公开仓库。
3. 更新面向用户的支持列表和 `CHANGELOG.md`。
4. 运行 `npm run compile` 和 `npm test`，并在 Extension Development Host 中验证终端创建、会话路由和工具切换。

## 测试安装

`npm run install:everywhere` 用于把选定 VSIX 安装到本地和远端开发环境。默认目标只有 VS Code：本地使用 `code`，远端使用 `.vscode-server`。

显式测试其他 VS Code 类 IDE：

```bash
bash ./scripts/install-everywhere.sh --local-editors "code=VS Code,cursor=Cursor"
CLIHUB_REMOTE_SERVER_TARGETS=".vscode-server,.cursor-server" bash ./scripts/install-everywhere.sh
```

`npm run package:dev` 会生成主扩展和 Local Bridge 的开发版 VSIX。开发版使用高于当前 patch 的可见预发布版本，完成后自动恢复源码中的正式版本号。可通过 `CLIHUB_DEV_BUILD_LABEL=<label>` 设置可读后缀。

`npm run install:dev` 把最新开发包安装到本机 VS Code 和 `dev-server` 的 VS Code Server。`npm run install:dev:cursor-main` 只安装主扩展到本机 Cursor 和 `dev-server` Cursor Server，用于验证缺少 Local Bridge 时的提示和回退行为。

## 正式打包

仓库统一通过 `release.sh` 构建主扩展和 Local Bridge：

```bash
bash ./release.sh <version> --channel public
```

重建相同版本时增加 `--force`。公开包使用 `config/tool-manifest.public.json`。非公开包必须传入仓库外部的工具清单：

```bash
bash ./release.sh <version> --channel internal \
  --tool-manifest /absolute/path/to/tool-manifest.internal.json
```

## CI 发布

推送 `v*` tag 会触发 `.github/workflows/release.yml`：

1. 运行测试并生成 `cli-hub-<version>-public.vsix` 和 `cli-hub-local-bridge-<version>-public.vsix`。
2. 上传两个 VSIX 到对应的 GitHub Release 和 workflow artifact。
3. 使用独立 job 发布到 VS Code Marketplace 和 Open VSX，单个市场的临时故障不会阻塞另一个市场。
4. VS Code Marketplace 发布遇到瞬时错误时最多重试三次。

仓库需要配置以下 GitHub Actions secrets：

```bash
gh secret set VSCE_PAT --repo hxy91819/clihub
gh secret set OPENVSX --repo hxy91819/clihub
```

`VSCE_PAT` 来自 Visual Studio Marketplace publisher portal。`OPENVSX` 来自 Open VSX；创建 Token 前需要签署 Publisher Agreement。首次 Open VSX 发布会在缺少 namespace 时自动创建 `MasonHuang`。Token 只保存到 GitHub Actions secrets，不写入源码、文档示例值或 workflow。

需要针对已有 tag 重跑当前发布流程时，在 GitHub Actions 中手动运行 `Release` workflow 并传入 tag，也可以执行：

```bash
gh workflow run release.yml --repo hxy91819/clihub --ref main -f tag=v<version>
```
