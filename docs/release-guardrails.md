# 发布复盘与防护策略

本文档记录 CLI Hub 双插件、双市场发布过程中已经出现的实际问题，以及仓库中对应的长期防护。目标不是保存一次性的操作过程，而是让相同问题尽量在本地或 CI 阶段被自动拦截。

## 已暴露的问题

| 问题 | 根因 | 当前防护 |
| --- | --- | --- |
| VS Code Marketplace 拒绝 publisher | manifest 的 publisher 与 Marketplace 账号不一致 | `validate:release` 固定检查两个 manifest 均为 `MasonHuang` |
| 主插件与 Local Bridge 版本漂移 | 两个独立 `package.json` 需要同步 | `release.sh` 同步版本；validator 同时检查 package、lockfile 和 Bridge |
| 图标出现黑边或格式不合适 | 透明背景丢失，或市场资产与源码预期不一致 | validator 检查图标为方形 PNG、尺寸至少 128px 且包含 alpha 通道 |
| 市场说明页混入开发和 Token 内容 | 根 README 同时被当作仓库文档和市场 README | 根 README 只写用户功能/使用/配置；validator 拦截开发标题、维护命令、Secret 名和版本化 VSIX 文件名 |
| 本机 gitignored 私有文件进入公开 VSIX | `vsce` 打包工作区文件，不关心文件是否被 Git 跟踪 | `.vscodeignore` 显式排除内部 manifest、开发文档和维护脚本；打包后再次检查 VSIX 文件列表和包内 manifest/README |
| 一个市场超时阻塞另一个市场 | 发布步骤串行放在同一个 job | VS Code Marketplace 与 Open VSX 使用独立 job，并共同依赖构建产物 |
| Marketplace 偶发请求超时 | 外部服务瞬时故障 | 两个市场的每个 VSIX 最多重试三次，重复发布使用 `--skip-duplicate` |
| 同一市场中第一个 VSIX 失败导致第二个未尝试 | shell 在首个非零退出码处终止 | 两个市场都按 VSIX 独立重试，最后汇总失败状态 |
| Open VSX Token 可用但 namespace 不存在 | 首次发布必须先创建与 publisher 同名的 namespace | CI 查询 `MasonHuang` namespace，404 时自动创建 |
| Secret 名称与 CLI 环境变量不一致 | GitHub Secret 使用 `OPENVSX`，`ovsx` CLI 读取 `OVSX_PAT` | workflow 显式映射 `OVSX_PAT: ${{ secrets.OPENVSX }}`；validator 检查两个 Secret 引用 |
| `ovsx publish` 成功后 Cursor 仍暂时搜不到 | Open VSX 的扫描和公开索引是异步的 | CI 轮询主插件和 Bridge 的精确版本 API，并读取线上 README；默认最多等待约三分钟 |
| GitHub Actions 出现 Node runtime 弃用警告 | 官方 action 的旧主版本仍使用已弃用 runtime | CI 使用当前受支持的 checkout/setup-node/upload/download artifact 主版本；升级前查看官方 release notes |
| Cursor 首次查询仍返回旧缓存 | Cursor 自身市场缓存晚于 Open VSX API | 先确认 Open VSX 精确版本可下载，再等待并重试 Cursor；不要立刻重复发版 |
| 为重跑 CI 移动旧 tag 的风险 | tag 触发 workflow 与 workflow 版本耦合 | `workflow_dispatch` 接受已有 tag；使用 `main` 的最新 workflow checkout 旧 tag 内容，不改写 tag |

## 自动校验

运行：

```bash
npm run validate:release
```

校验覆盖：

- 主插件、Local Bridge、`package-lock.json` 版本一致。
- 两个扩展的 name、publisher 和 icon 路径符合发布约定。
- 两个 PNG 图标为方形、尺寸足够并带 alpha 通道。
- 市场 README 不包含开发章节、发布命令、Credential 名称或易过期的版本化 VSIX 文件名。
- Local Bridge README 保留用户需要的 Remote SSH、iTerm2 和配置说明，但不暴露隐藏命令。
- 开发文档承接本地开发、测试安装、打包、CI 和 Secret 配置。
- release workflow 保持构建、VS Code Marketplace、Open VSX 三个独立 job，并保留可重复发布能力。
- `.vscodeignore` 保持私有/开发文件排除规则；`release.sh` 在打包后检查两个 VSIX 的实际内容。

校验会在三个入口执行：普通 CI、正式 release CI、直接运行 `release.sh`。新增发布约束时，应优先扩展 `scripts/validate-release.js`，不能只在文档中增加提醒。

## 发布后的判断顺序

1. 先看 `build-release`，确认测试、两个 VSIX、workflow artifact 和 GitHub Release 成功。
2. 分别看两个市场 job。一个失败不代表另一个失败。
3. VS Code Marketplace 的上传超时先由 CI 重试；仍失败时重跑同一 tag，不创建无内容的新版本。
4. Open VSX 以精确版本 API 可下载为最终成功条件，不以搜索结果或 `latest` 缓存为准。
5. Open VSX 已可下载但 Cursor 尚未搜索到时，按缓存延迟处理，短暂等待后重试。
6. 发布完成后确认 GitHub Release 同时包含主插件和 Local Bridge 两个 VSIX。

## 仍需人工确认

- VS Code Marketplace 页面是否已刷新到新版本及新 README。当前 CI 能确认发布命令成功，但未调用 Marketplace 页面审核 API。
- 图标透明通道由脚本检查，边缘观感、缩放清晰度仍需在 VS Code/Cursor 扩展列表中查看。
- macOS Automation 权限、iTerm2 前台激活和 Remote SSH Local Bridge 路由需要真实环境验证。
- Token 只写入 GitHub Actions secrets。不要粘贴到聊天、终端历史、源码、日志或 workflow 文件。
