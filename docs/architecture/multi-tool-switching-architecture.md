# Multi-Tool Switching Architecture

## 支持的 AI 工具列表

工具来源于构建期注入的 manifest。公开版默认读取 `config/tool-manifest.public.json`，release 流程可在打包前注入 `config/tool-manifest.json` 以覆盖当前产物的工具清单。

当前公开版内置工具包括：`codebuddy`、`gemini`、`claude`、`codex`、`opencode`、`copilot`、`cursor-agent`。

## 工具切换流程

**用户操作**：点击状态栏或执行 `clihub.switchAITool`

### 流程（当前版本）
1. 弹出 Quick Pick 选择目标工具。
2. 若未变更工具，直接返回。
3. 更新当前工具状态与状态栏显示。
4. 检查当前激活终端：
- 若为 CLI Hub 终端：在该终端内执行切换（`switchCliInTerminal`）。
- 若不是：走打开流程（复用优先，必要时新建）。

### 关键点
- 不再“先销毁旧终端再创建新终端”作为默认路径。
- 优先保持用户当前激活会话上下文，减少会话中断。

## 工具安装检测

### 检测时机
- 打开终端前
- 切换工具后首次启动目标 CLI
- 手动执行 `clihub.refreshDetection`

### 检测方式
- macOS/Linux: `which <tool>`
- Windows: `where <tool>`

### 未安装处理
- 弹出安装提示
- 若用户确认，在新终端执行安装命令
- Codebuddy 在 macOS/Linux 提供 `Repair` 入口

## 与会话路由的关系

工具切换与发送路由共享会话元数据：
- `switchAITool` 会更新激活会话的 `toolId`
- `sendPathToTerminal` 依据 `toolId` 与激活状态选择目标会话

这确保了“切换后立即发送”落在同一激活会话。
