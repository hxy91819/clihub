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

当任务要求“本地安装测试”“安装本地开发版”或“在 VS Code 中体验当前代码”时，应实际执行以下统一入口，并以安装后的版本校验成功作为完成标准；只生成 VSIX 不算完成安装。目标是 Cursor 或其他 VS Code 类 IDE 时，按下文显式传入 `--editor`。

统一入口：

```bash
npm run dev:install
```

默认行为适合普通贡献者：

- 生成一对版本完全一致、且高于当前稳定 patch 的 Dev VSIX。
- 把主插件和 Local Bridge 安装到本机 VS Code。
- 不连接任何远端主机，不安装或升级 Codebuddy 等全局 AI CLI。
- 安装后读取 IDE 扩展列表，确认主插件和 Bridge 的实际版本。

本机需要 Node.js、npm、Python 3、Bash、`unzip` 和目标 IDE CLI；使用远端安装时，本机还需要 `ssh` / `scp`，远端需要 Node.js 与 `unzip`。缺失命令会在对应步骤返回明确错误。

### 本地 IDE

`--editor` 可重复使用。第一次显式传入会替换默认的 VS Code；值可以是 PATH 中的 CLI、可执行文件绝对路径，或 `cli=显示名称`：

```bash
npm run dev:install -- --editor cursor=Cursor
npm run dev:install -- --editor code="VS Code" --editor cursor=Cursor
npm run dev:install -- --editor /absolute/path/to/editor-cli="Custom IDE"
```

macOS 上即使 `code` / `cursor` 不在 PATH，安装器也会识别标准应用目录。其他 VS Code 类 IDE 通过 CLI 名称或绝对路径配置，不需要修改脚本。

### Remote SSH

远端安装是显式 opt-in。主插件安装到远端 Server，Local Bridge 只安装在本机 IDE：

```bash
npm run dev:install -- \
  --editor cursor=Cursor \
  --remote dev-server \
  --remote-root .cursor-server
```

`--remote` 和 `--remote-root` 都可重复。相对 root 从远端 home 目录解析；默认 root 是 `.vscode-server`。远端安装使用临时 staging 目录完成原子替换，并在成功或失败后清理上传的 VSIX 和解压目录。

只操作远端时使用 `--no-local`。但测试 Remote SSH 到本机 iTerm2 时，本机仍需要 Local Bridge，因此该场景通常不要跳过本地安装。

### 调试变体

```bash
# 自定义可读 Dev 版本后缀
npm run dev:install -- --label bridge-test

# 验证缺少 Local Bridge 时的提示；会主动卸载目标 IDE 中的 Bridge
npm run dev:install -- --main-only

# 复用仓库根目录中最新、版本严格匹配的 Dev VSIX 对
npm run dev:install -- --skip-package

# 只打印打包、IDE 和 SSH 操作，不执行任何修改
npm run dev:install -- --dry-run --editor cursor --remote dev-server --remote-root .cursor-server
```

`--skip-package` 只自动选择带 `-dev.` 的成对包，不会误选稳定版或把 Local Bridge 当作主插件。也可以同时传入 `--main-vsix` / `--bridge-vsix` 指定包；安装前会读取包内 manifest 校验 ID 和版本。

可用环境变量为个人工作站保存默认目标：

```bash
export CLIHUB_DEV_EDITORS="code=VS Code,cursor=Cursor"
export CLIHUB_DEV_REMOTES="dev-server"
export CLIHUB_DEV_REMOTE_ROOTS=".vscode-server,.cursor-server"
```

只生成 Dev VSIX、不安装：

```bash
npm run dev:package
```

开发打包完成后会自动恢复源码中的正式版本号。运行 `npm run dev:install -- --help` 可查看完整参数。

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
