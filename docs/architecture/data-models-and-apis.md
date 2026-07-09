# Data Models and APIs

## Extension Configuration Schema

**命名空间**：`clihub`

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `clihub.terminalCommand` | string | `"codebuddy"` | 默认工具 ID（用于新工作区初始选择） |
| `clihub.autoShowLogsOnStartup` | boolean | `false` | 启动时是否自动展示日志面板 |
| `clihub.nativeTerminalLocation` | `"panel" \| "right"` | `"panel"` | 原生终端展示位置；`panel` 不干预布局，`right` 强制将面板移到右侧 |
| `clihub.pathSendTarget` | `"vscodeTerminal" \| "iterm2"` | `"vscodeTerminal"` | 路径上下文发送目标；默认走 CLI Hub VS Code 终端路由，`iterm2` 通过 macOS AppleScript 写入 iTerm2 当前 session |
| `clihub.toolArguments` | object | `{}` | 各工具附加 CLI 参数 |
| `clihub.toolEnvironments` | object | `{}` | 各工具注入环境变量 |

**已移除/废弃**：
- `clihub.terminalOpenMode`
- `clihub.autoCleanStaleTerminalTabs`

## Extension Commands

| 命令 ID | 标题 | 说明 | 快捷键 |
|---------|------|------|--------|
| `clihub.openTerminalEditor` | Open Terminal | 打开终端（复用优先） | - |
| `clihub.openNewTerminalSession` | Open New Terminal Session | 强制新建终端会话 | `Cmd+Ctrl+Shift+J` (Mac)<br>`Ctrl+Alt+Shift+J` (Win/Linux) |
| `clihub.sendPathToTerminal` | Send File Path to AI Tool Terminal | 发送文件/目录路径到终端 | `Cmd+Shift+J` (Mac)<br>`Ctrl+Shift+J` (Win/Linux) |
| `clihub.copyPathToClipboard` | Copy File Path to Clipboard | 复制文件/目录路径上下文到剪贴板，不打开或发送到终端 | - |
| `clihub.switchAITool` | Switch AI Tool | 切换 AI 工具 | - |
| `clihub.setGlobalDefaultTool` | Set Global Default AI Tool | 设置全局默认工具 | - |
| `clihub.refreshDetection` | Refresh Tool Installation Detection | 重新检测工具安装状态 | - |
| `clihub.showLogs` | Show CLI Hub Logs | 显示日志面板 | - |

## Session Data Model

会话元数据（`sessionRegistry`）：

```typescript
interface TerminalSessionMeta {
  terminal: vscode.Terminal;
  toolId: string;
  workspacePath?: string;
  createdAt: number;
  lastActiveAt: number;
}
```

当 `clihub.pathSendTarget = "vscodeTerminal"` 时，路由规则：
1. 当前激活且 tool/workspace/environment 匹配的 CLI Hub 终端
2. 最近活跃且 tool/workspace/environment 匹配的 CLI Hub 会话
3. 不存在则自动新建

当 `clihub.pathSendTarget = "iterm2"` 时，`clihub.sendPathToTerminal` 不创建/复用 VS Code 终端，而是通过 `osascript` 写入 iTerm2 当前窗口的 current session。

## UI Integration Points

- 状态栏项：显示当前工具，点击触发 `clihub.switchAITool`
- 编辑器标题栏按钮：触发 `clihub.openTerminalEditor`
- 编辑器/资源管理器右键菜单：触发 `clihub.sendPathToTerminal`
- 编辑器/资源管理器右键菜单：触发 `clihub.copyPathToClipboard`
