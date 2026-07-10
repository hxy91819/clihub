# 开发与发布

本文档面向 CLI Hub 维护者，记录本地开发、测试安装、工具清单扩展和发布流程。扩展市场展示的根目录 `README.md` / `README.zh-CN.md` 只维护用户使用说明。

## 本地开发

```bash
npm install
npm run compile
npm test
npm run validate:release
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

### 发布前清单

1. 确认 `git status --short` 中只有本次发布需要的改动。
2. 运行 `npm run validate:release`，检查双插件版本、publisher、图标、README 边界和 workflow 结构。
3. 运行 `npm test`。
4. 使用 `release.sh` 生成两个 VSIX；脚本会检查包内 `package.json`、README 和文件列表，阻止内部 manifest、开发文档或维护脚本进入公开包。
5. 提交版本改动后再创建 tag，确保 tag 指向包含当前 workflow 的提交。

## CI 发布

推送 `v*` tag 会触发 `.github/workflows/release.yml`：

1. 运行测试并生成 `cli-hub-<version>-public.vsix` 和 `cli-hub-local-bridge-<version>-public.vsix`。
2. 上传两个 VSIX 到对应的 GitHub Release 和 workflow artifact。
3. 使用独立 job 发布到 VS Code Marketplace 和 Open VSX，单个市场的临时故障不会阻塞另一个市场。
4. 两个市场都按 VSIX 独立尝试，单个包遇到瞬时错误时最多重试三次；某个包最终失败也不会阻止另一个包被尝试。
5. Open VSX 发布后轮询两个精确版本及其线上 README，直到公开 API 可下载，默认最多等待约三分钟，避免把异步索引延迟误判为失败或成功。

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

不要移动或覆盖已发布 tag。手动重跑会使用 `main` 上最新 workflow，但 checkout 和打包内容仍来自传入的已有 tag。

完整故障复盘和长期防护策略见 `docs/release-guardrails.md`。
