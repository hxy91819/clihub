# Terminal Session Routing (Native-Only)

## 背景
从 2026-03 起，CLI Hub 终端架构从“单终端 + editor/native 双模式”调整为“多会话 + native-only”。

## 当前行为

### 1) 会话模型
- 使用 `sessionRegistry` 维护所有 CLI Hub 终端会话。
- 每个会话记录：`terminal`、`toolId`、`workspacePath`、`createdAt`、`lastActiveAt`。

### 2) 路由优先级
当 `clihub.pathSendTarget = "vscodeTerminal"`（默认值）时，`clihub.sendPathToTerminal` 发送目标规则：
1. 当前激活终端（必须是 CLI Hub 且 tool 匹配）
2. 最近活跃且 tool/workspace/environment 均匹配的会话
3. 若都不存在，自动创建新会话再发送

当 `clihub.pathSendTarget = "iterm2"` 时，`clihub.sendPathToTerminal` 不创建或复用 VS Code 终端：
- 本地窗口：主扩展直接通过 macOS AppleScript 写入 iTerm2 当前窗口的 current session。该模式需要 iTerm2 正在运行，并授予 VS Code Automation 权限。
- Remote SSH 窗口：主扩展运行在远端 extension host，不执行远端 `osascript`；它调用本机 UI extension host 中 companion 扩展提供的 `clihubLocal.writeToIterm2(text)`。若 companion 缺失，提示安装 `MasonHuang.cli-hub-local-bridge`，并提供回退到 VS Code terminal 路由的操作。

### 3) 打开终端
- `clihub.openTerminalEditor`：复用优先（激活 > 最近活跃 > 新建），但仅复用与当前 workspace 和工具环境匹配的会话
- `clihub.openNewTerminalSession`：始终新建会话
- `clihub.nativeTerminalLocation`：控制 CLI Hub 原生终端展示位置
  - `panel`：不主动改变面板位置
  - `right`：打开/复用终端时强制将面板移到右侧

### 4) 切换工具
`clihub.switchAITool` 的优先行为：
- 若当前激活终端是 CLI Hub，且 workspace / environment 也满足目标工具要求，会在该终端内同步切换 CLI（不中断终端窗口）
- 否则按常规打开流程定位/创建目标工具会话

## 已移除能力
- 不再支持 Terminal Editor 模式
- 不再维护 `clihub.terminalOpenMode`
- 不再维护陈旧 Terminal Editor 标签清理逻辑

## 迁移兼容
- 激活时若检测到历史 `terminalOpenMode=editor`，会自动写回 `native` 并提示一次。

## 对开发者的要求
- 新增终端相关能力时，不得重新引入 editor/native 双分支。
- 路由逻辑必须保持“激活优先”语义，除非有明确产品决策变更。
- 若修改会话模型，必须同步更新 `src/test/suite/terminal-adoption.test.ts`。
