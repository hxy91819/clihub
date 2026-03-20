# Codebuddy Terminal Editor - Brownfield Architecture Document

## Introduction

本文档记录了 Codebuddy Terminal Editor VS Code 扩展的**当前实际状态**，包括技术债务、已知问题和实际使用的模式。本文档旨在为 AI agents 提供准确的参考，以便进行 bug 修复和功能增强。

### Document Scope

全面记录整个系统的当前状态，重点关注：
- 终端生命周期管理（最复杂的部分）
- 多 AI 工具切换机制
- 已知问题和技术债务

### Change Log

| Date       | Version | Description          | Author    |
|------------|---------|----------------------|-----------|
| 2025-10-24 | 1.0     | 初始 brownfield 分析 | Winston (Architect) |
| 2025-10-24 | 1.1     | 更新：移除已修复的 group 自动关闭问题 | Winston (Architect) |

## Quick Reference - Key Files and Entry Points

### Critical Files for Understanding the System

- **主入口**: `src/extension.ts` (550行) - 所有扩展逻辑的单一文件
- **终端工具函数**: `src/terminal-utils.ts` (125行) - 终端状态判断和分组管理
- **配置清单**: `package.json` - 扩展声明、命令、配置项
- **TypeScript 配置**: `tsconfig.json` - 编译选项
- **测试套件**:
  - `src/test/suite/terminal-utils.test.ts` - 单元测试（36个用例）
  - `src/test/suite/terminal-adoption.test.ts` - 集成测试（5个用例）
  - `src/test/suite/test-helpers.ts` - 测试辅助函数

### Key Entry Points by Use Case

| 使用场景 | 入口点 | 文件位置 |
|---------|--------|---------|
| 打开终端 | `codebuddy.openTerminalEditor` 命令 | `src/extension.ts:331` |
| 发送文件路径 | `codebuddy.sendPathToTerminal` 命令 | `src/extension.ts:433` |
| 切换 AI 工具 | `codebuddy.switchAITool` 命令 | `src/extension.ts:311` |
| 清理陈旧终端 | `cleanStaleTerminalTabs()` 函数 | `src/extension.ts:41` |
| 终端状态解析 | `resolveCodebuddyTerminal()` 函数 | `src/extension.ts:251` |

## High Level Architecture

### Technical Summary

这是一个**轻量级 VS Code 扩展**，专注于提供流畅的 AI CLI 工具集成体验。核心价值在于：
1. 一键启动多种 AI CLI 工具（Codebuddy、Gemini、Claude 等）
2. 智能终端生命周期管理，避免重复创建
3. 快捷键快速发送文件路径到 AI 工具

**架构特点**：
- 单文件设计（`src/extension.ts`）包含所有核心逻辑
- 状态驱动的终端管理
- 事件监听式的终端追踪
- 无外部运行时依赖（仅开发时依赖）

### Actual Tech Stack

| Category | Technology | Version | Notes |
|----------|------------|---------|-------|
| Runtime | VS Code Extension Host | ^1.99.0 | 最低要求版本 |
| Language | TypeScript | 5.9.3 | 启用 strict 模式 |
| 编译目标 | ES2020 | - | Node.js 兼容 |
| 测试框架 | Mocha | 11.7.4 | BDD 风格 |
| 测试运行器 | @vscode/test-electron | 2.5.2 | VS Code 官方测试工具 |
| 打包工具 | @vscode/vsce | - | 手动安装，非项目依赖 |

**关键依赖**：
```json
{
  "devDependencies": {
    "@types/vscode": "1.99.0",
    "@types/node": "^24.6.2",
    "@types/mocha": "^10.0.10",
    "@vscode/test-electron": "^2.5.2",
    "mocha": "^11.7.4",
    "typescript": "^5.9.3"
  }
}
```

**运行时依赖**：无（所有依赖仅用于开发和测试）

### Repository Structure Reality Check

- **类型**: 单一仓库（Monorepo 架构，但仅包含一个扩展）
- **包管理器**: npm
- **构建输出**: `out/` 目录（TypeScript 编译后的 JS 文件）
- **版本控制**: Git（仓库地址已在公开版本中脱敏）

## Source Tree and Module Organization

### Project Structure (Actual)

```
clihub/
├── src/
│   ├── extension.ts              # 核心扩展逻辑（550行）- 所有命令、事件处理
│   ├── terminal-utils.ts         # 终端工具函数（125行）- 状态判断、分组查找
│   └── test/
│       ├── runTest.ts            # 测试运行器入口
│       └── suite/
│           ├── index.ts          # Mocha 配置
│           ├── test-helpers.ts   # 测试辅助函数
│           ├── terminal-utils.test.ts       # 单元测试（36个）
│           └── terminal-adoption.test.ts    # 集成测试（5个）
├── out/                          # 编译输出目录（.gitignore）
├── node_modules/                 # npm 依赖（.gitignore）
├── docs/
│   └── TESTING.md                # 测试文档
├── .bmad-core/                   # BMAD 代理系统配置（.gitignore）
├── package.json                  # 扩展清单 + npm 配置
├── tsconfig.json                 # TypeScript 编译配置
├── .vscodeignore                 # 打包排除文件
├── CODEBUDDY.md                  # 开发者指南（英文）
├── README.md                     # 用户文档（中文）
├── README_EN.md                  # 用户文档（英文）
└── CHANGELOG.md                  # 版本变更记录
```

### Key Modules and Their Purpose

#### 1. `src/extension.ts` - 核心扩展逻辑（550行）

**职责**：
- 扩展激活/停用生命周期管理
- 所有命令注册和处理
- 终端生命周期管理（创建、复用、销毁）
- 全局状态管理（当前工具、安装状态、终端引用）
- 事件监听（终端打开、关闭）

**关键全局变量**：
```typescript
let codebuddyTerminal: vscode.Terminal | undefined;      // 当前追踪的终端
let codebuddyInstallationChecked = false;                // 是否已检查安装
let codebuddyInstalled = false;                          // CLI 工具是否已安装
let isOpeningTerminal = false;                           // 防并发标志
let log: vscode.LogOutputChannel;                        // 日志通道
let statusBarItem: vscode.StatusBarItem | undefined;     // 状态栏项
let currentToolId: string = 'codebuddy';                 // 当前选择的工具 ID
let terminalGroupLocked = false;                         // 编辑器分组是否已锁定
let codebuddyTerminalGroup: vscode.TabGroup | undefined; // 终端所在的编辑器分组
```

**核心函数**：
- `activate()` (292行) - 扩展激活入口
- `openTerminalEditor` 命令 (331行) - 打开/显示终端
- `sendPathToTerminal` 命令 (433行) - 发送文件路径
- `switchAITool` 命令 (311行) - 切换 AI 工具
- `resolveCodebuddyTerminal()` (251行) - 解析当前终端状态
- `checkCommandInstalled()` (269行) - 检测 CLI 工具安装状态
- `cleanStaleTerminalTabs()` (41行) - 清理陈旧的 shell 标签

**已知行为**：
1. **`vscode.ViewColumn.Two` 依赖 VS Code 内部调度** - 个别情况下 VS Code 会先在 Panel 中创建终端，再异步挂载到 Editor。扩展仅记录调试日志，不再主动搬移终端。

#### 2. `src/terminal-utils.ts` - 终端工具函数（125行）

**职责**：
- 终端类型判断（是否在 Editor、是否为通用 shell）
- 终端所属分组查找
- 终端配置摘要（用于调试日志）

**导出函数**：
- `isTerminalInEditor(terminal)` - 判断终端是否在 Terminal Editor
- `findGroupForTerminal(terminal)` - 查找终端所在的 TabGroup
- `getEditorTerminals()` - 获取所有 Editor 中的终端
- `isGenericShellPath(shellPath)` - 判断是否为通用 shell（zsh/bash/node 等）
- `shellPathMatchesTool(shellPath, toolId)` - shellPath 是否匹配工具 ID
- `shellArgsIncludeTool(shellArgs, toolId)` - shellArgs 是否包含工具 ID
- `nodeWrapperMatchesTool(options, toolId)` - 是否为 node 包装器调用
- `summarizeTerminalOptions(options)` - 生成终端配置摘要字符串

**测试覆盖**：36个单元测试，100% 函数覆盖

#### 3. `src/test/` - 测试套件

详见 `docs/TESTING.md`，关键点：
- **单元测试**: 36个用例，覆盖所有 `terminal-utils.ts` 导出函数
- **集成测试**: 5个用例，覆盖终端创建、复用、并发保护
- **测试策略**: 先集成测试锁定行为，再单元测试补齐工具函数
- **测试隔离**: `afterEach` 清理所有终端

## Core Architecture - Terminal Lifecycle Management

### 终端生命周期状态机

终端在扩展中经历以下状态：

```
[不存在] 
   ↓ openTerminalEditor
[创建中] (isOpeningTerminal = true)
   ↓
[已创建] (codebuddyTerminal 被赋值)
   ↓
[已显示] (terminal.show())
   ↓
[等待 Editor 挂载] (VS Code 负责)
   ↓
[分组已锁定] (lockSecondEditorGroup)
   ↓
[复用状态] (后续调用 openTerminalEditor 复用同一终端)
   ↓ 用户关闭终端 或 switchAITool
[销毁中] (disposeTrackedTerminal)
   ↓
[已销毁] (codebuddyTerminal = undefined)
```

### 关键机制

#### 1. 终端复用机制

**目标**：避免重复创建终端，提升用户体验

**实现**：`resolveCodebuddyTerminal()` (src/extension.ts:251)

```typescript
function resolveCodebuddyTerminal(toolId: string): vscode.Terminal | undefined {
  if (!codebuddyTerminal) {
    return undefined;  // 无追踪的终端
  }
  if (codebuddyTerminal.exitStatus) {
    codebuddyTerminal = undefined;
    return undefined;  // 终端已退出
  }
  const expectedName = getToolLabel(toolId);
  if (expectedName && codebuddyTerminal.name !== expectedName) {
    return undefined;  // 名称不匹配（工具已切换）
  }
  return codebuddyTerminal;  // 可复用
}
```

**判断逻辑**：
1. 检查全局变量 `codebuddyTerminal` 是否存在
2. 检查终端是否已退出（`exitStatus` 不为空表示已退出）
3. 检查终端名称是否匹配当前工具 ID
4. 所有条件满足 → 复用；否则 → 返回 undefined，触发创建新终端

#### 2. 并发保护机制

**问题**：用户快速连续点击终端按钮，可能创建多个终端

**解决方案**：`isOpeningTerminal` 标志位 (src/extension.ts:331)

```typescript
let isOpeningTerminal = false;

const disposable = vscode.commands.registerCommand('codebuddy.openTerminalEditor', async () => {
  if (isOpeningTerminal) {
    log.debug('[Codebuddy] openTerminalEditor: skip because already opening');
    return;  // 如果正在打开，直接返回
  }
  isOpeningTerminal = true;
  
  try {
    // ... 终端创建逻辑 ...
  } finally {
    isOpeningTerminal = false;  // 无论成功失败，都重置标志
  }
});
```

**集成测试验证**：`terminal-adoption.test.ts` 测试 4

#### 3. 编辑器分组锁定机制

**目标**：防止其他文件替换 Codebuddy 终端所在的编辑器分组

**实现**：
```typescript
async function lockSecondEditorGroup() {
  await focusSecondEditorGroup();
  try {
    await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
    terminalGroupLocked = true;
  } catch {
    terminalGroupLocked = false;
  }
}
```

**触发时机**：
- `openTerminalEditor` 创建/显示终端后自动锁定 (src/extension.ts:425)

**解锁时机**：
- `disposeTrackedTerminal` 销毁终端时解锁 (src/extension.ts:247)
- `onDidCloseTerminal` 用户关闭终端时解锁 (src/extension.ts:533)

**改进历史**：
- ✅ ~~分组锁定后，关闭终端时 group 不会自动关闭~~ - 已在 v0.0.8 修复

#### 4. 陈旧终端清理机制

**问题**：VS Code 重启后可能残留 zsh/bash 等默认 shell 标签

**解决方案**：`cleanStaleTerminalTabs()` (src/extension.ts:41)

**清理策略**：
```typescript
function isLikelyStaleShellLabel(label: string, config: CodebuddyConfig): boolean {
  if (label === config.terminalName) return false;  // 不处理当前 Codebuddy 终端
  if (AI_TOOLS.some(tool => tool.label === label)) return false;  // 不处理已知 AI 工具
  const l = label.toLowerCase();
  const commonShells = new Set(['zsh', 'bash', 'sh', 'pwsh', 'powershell', 'cmd', 'fish']);
  return commonShells.has(l);  // 仅清理明显的默认 shell
}
```

**清理模式**（配置项 `codebuddy.autoCleanStaleTerminalTabs`）：
- `off` - 不清理
- `prompt` - 提示用户是否清理（默认）
- `auto` - 自动清理，不提示

**触发时机**：目前未在代码中自动触发，仅提供手动命令 `codebuddy.cleanStaleTerminalTabs`

**改进建议**：可在 `activate()` 或 `openTerminalEditor` 中自动触发清理

#### 5. 终端分组追踪机制

**目标**：关闭终端时自动清理空的编辑器分组

**实现**：
```typescript
let codebuddyTerminalGroup: vscode.TabGroup | undefined;

// 终端创建后记录所在分组
codebuddyTerminalGroup = findGroupForTerminal(terminal);

// 终端关闭时尝试清理空分组
async function closeTrackedGroupIfEmpty() {
  const group = codebuddyTerminalGroup;
  codebuddyTerminalGroup = undefined;
  if (!group) return;
  try {
    if (group.tabs.length === 0) {
      await vscode.window.tabGroups.close(group, true);
      log.info('[Codebuddy] Closed empty terminal editor group');
    }
  } catch { /* ignore */ }
}
```

**已知问题**：
- 有时 group 关闭失败，导致空分组残留
- 可能原因：VS Code API 的异步时序问题，或 group 引用失效

## Multi-Tool Switching Architecture

### 支持的 AI 工具列表

```typescript
const AI_TOOLS: AIToolDescriptor[] = [
  { id: 'codebuddy', label: 'Codebuddy', description: 'Tencent AI Codebuddy' },
  { id: 'gemini', label: 'Gemini CLI', description: 'Google Gemini CLI' },
  { id: 'claude', label: 'Claude Code', description: 'Anthropic Claude Code' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex' },
  { id: 'copilot', label: 'Copilot', description: 'GitHub Copilot CLI' },
  {
    id: 'cursor-agent',
    label: 'Cursor CLI',
    description: 'Cursor CLI (cursor-agent)',
    installCommand: 'curl https://cursor.com/install -fsS | bash',
  },
];
```

### 工具切换流程

**用户操作**：点击状态栏或执行 `codebuddy.switchAITool` 命令

**执行步骤**：
1. 显示快速选择面板（`vscode.window.showQuickPick`）
2. 用户选择新工具
3. 如果工具与当前工具相同，直接返回
4. 销毁旧终端：`disposeTrackedTerminal(existingTerminal)`
5. 更新全局状态：`currentToolId = selected`
6. 更新状态栏：`updateStatusBar(selected)`
7. 自动打开新终端：`executeCommand('codebuddy.openTerminalEditor')`

**关键代码**：src/extension.ts:311-329

```typescript
const switchAIToolDisposable = vscode.commands.registerCommand('codebuddy.switchAITool', async () => {
  const previousTool = currentToolId;
  const selected = await selectAITool(context);
  if (selected) {
    if (selected === previousTool) {
      return;  // 未切换，直接返回
    }

    const existingTerminal = resolveCodebuddyTerminal(previousTool);
    await disposeTrackedTerminal(existingTerminal);  // 销毁旧终端

    currentToolId = selected;
    try {
      await vscode.commands.executeCommand('codebuddy.openTerminalEditor');  // 打开新终端
    } catch (error) {
      log.error(`[Codebuddy] Failed to reopen terminal for ${selected}: ${error}`);
    }
  }
});
```

### 工具安装检测

**检测时机**：
- 首次调用 `openTerminalEditor` 时
- 切换工具后打开终端时
- 手动执行 `codebuddy.refreshDetection` 时

**检测方法**：
```typescript
async function checkCommandInstalled(context, cmdOverride?, forceCheck = false): Promise<boolean> {
  const command = process.platform === 'win32' ? `where ${cmdToCheck}` : `which ${cmdToCheck}`;
  exec(command, (error) => {
    const isInstalled = !error;
    // 缓存结果到 globalState
    context.globalState.update('codebuddyInstalled', isInstalled);
  });
}
```

**缓存策略**：
- 结果缓存到 `context.globalState`（持久化存储）
- 避免每次打开终端都执行 shell 命令

**未安装处理**：
- 弹出提示："Codebuddy is not installed. Would you like to install it?"
- 用户点击 "Install" → 在新终端执行安装命令
- 安装命令来源：
  - 工具自定义 `installCommand`（如 Cursor CLI）
  - 或从 `COMMAND_TO_PACKAGE_MAP` 映射生成 `npm install -g <package>`

## Data Models and APIs

### Extension Configuration Schema

**命名空间**：`codebuddy`

**配置项**：

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `codebuddy.terminalCommand` | string | `"codebuddy"` | 要执行的 CLI 命令（已废弃，现用工具切换机制） |
| `codebuddy.terminalName` | string | `"Codebuddy Code"` | 终端显示名称（已废弃） |
| `codebuddy.autoShowLogsOnStartup` | boolean | `false` | 是否在启动时自动显示日志面板 |
| `codebuddy.autoCleanStaleTerminalTabs` | enum | `"prompt"` | 自动清理陈旧终端的模式：`"off"` / `"prompt"` / `"auto"` |

**注意**：`terminalCommand` 和 `terminalName` 配置项已被工具切换机制替代，但为保持向后兼容仍保留。

### Extension Commands

| 命令 ID | 标题 | 说明 | 快捷键 |
|---------|------|------|--------|
| `codebuddy.openTerminalEditor` | Codebuddy | 打开/显示 Codebuddy 终端 | - |
| `codebuddy.sendPathToTerminal` | Send File Path to Codebuddy Terminal | 发送文件路径到终端 | `Cmd+Shift+J` (Mac)<br>`Ctrl+Shift+J` (Win/Linux) |
| `codebuddy.switchAITool` | Switch AI Tool | 切换 AI 工具 | - |
| `codebuddy.refreshDetection` | Refresh Codebuddy Installation Detection | 重新检测工具安装状态 | - |
| `codebuddy.cleanStaleTerminalTabs` | Clean Stale Terminal Tabs | 清理陈旧的终端标签 | - |
| `codebuddy.showLogs` | Show Codebuddy Logs | 显示日志面板 | - |

### UI Integration Points

**状态栏项**：
- 位置：右侧
- 图标：`$(terminal)`
- 文本：当前工具名称（如 "Codebuddy"）
- 点击行为：执行 `codebuddy.switchAITool`

**编辑器标题栏按钮**：
- 条件：`resourceScheme != 'vscode-terminal'`（非终端 tab 时显示）
- 命令：`codebuddy.openTerminalEditor`
- 分组：`navigation@9`

**右键菜单**：
- 编辑器上下文菜单：`codebuddy.sendPathToTerminal`
- 资源管理器上下文菜单：`codebuddy.sendPathToTerminal`（仅文件，非文件夹）

## Technical Debt and Known Issues

### 已知关键问题

#### 1. 打开终端时偶尔在错误的 group 创建 tab ⚠️

**现象**：
- 执行 `openTerminalEditor` 时，终端 tab 有时出现在非预期的编辑器分组
- 预期：在 `vscode.ViewColumn.Two`（第二列）创建
- 实际：偶尔在 `ViewColumn.One` 或其他列创建

**根本原因**：
- `location: { viewColumn: vscode.ViewColumn.Two }` 配置不总是生效
- 可能与当前编辑器布局状态有关（如只有一列时，Two 无法创建）

**相关代码**：src/extension.ts:388-398

**影响**：用户体验不一致

**建议修复方案**：
- 创建终端后，检查其所在的 group 是否符合预期
- 如不符合，使用 `workbench.action.moveEditorToNextGroup` 或类似命令移动
- 或在创建前先确保编辑器布局有两列（如执行 `workbench.action.splitEditor`）

### 技术债务

#### 1. 单文件架构限制

**现状**：
- `src/extension.ts` 包含 550 行代码，所有逻辑集中在一个文件
- 虽然目前可维护，但未来功能增加可能导致文件过大

**影响**：
- 代码定位稍慢
- 重构风险增加

**建议**：
- 未来可拆分为多个模块：
  - `terminal-manager.ts` - 终端生命周期管理
  - `tool-switcher.ts` - 工具切换逻辑
  - `commands.ts` - 命令注册
  - `config.ts` - 配置管理

#### 2. 全局状态管理

**现状**：
- 使用模块级全局变量管理状态（`codebuddyTerminal`, `currentToolId` 等）
- 虽然简单有效，但可能导致状态不一致

**风险**：
- 多处修改同一全局变量，难以追踪状态变化
- 重置状态时可能遗漏某些变量

**建议**：
- 考虑引入简单的状态管理类：
  ```typescript
  class ExtensionState {
    terminal?: vscode.Terminal;
    currentToolId: string = 'codebuddy';
    isOpeningTerminal: boolean = false;
    // ...
    reset() { /* 统一重置所有状态 */ }
  }
  ```

#### 3. 错误处理不一致

**现状**：
- 大量使用 `try { ... } catch { /* ignore */ }` 模式
- 错误被静默忽略，可能隐藏潜在问题

**示例**：
```typescript
try { log.info('[Codebuddy] Creating new terminal'); } catch { /* ignore */ }
```

**风险**：
- 调试困难，无法追踪错误根源

**建议**：
- 至少在 catch 块中记录错误：
  ```typescript
  try { log.info('[Codebuddy] Creating new terminal'); } 
  catch (e) { log.error(`Failed to log: ${e}`); }
  ```

#### 4. 配置项废弃但未移除

**现状**：
- `codebuddy.terminalCommand` 和 `codebuddy.terminalName` 已被工具切换机制替代
- 但仍在 `package.json` 中声明，且代码中仍读取这些配置

**影响**：
- 用户可能困惑哪些配置项是有效的
- 代码维护负担

**建议**：
- 在下个主版本中移除这些配置项
- 或在文档中明确标注为 "Deprecated"

## Integration Points and External Dependencies

### External Services

**无外部服务依赖**

本扩展不调用任何外部 HTTP API 或云服务，所有功能均在本地执行。

### VS Code API Dependencies

**关键使用的 VS Code API**：

| API | 用途 | 关键位置 |
|-----|------|---------|
| `vscode.window.createTerminal()` | 创建终端 | src/extension.ts:400 |
| `vscode.window.terminals` | 获取所有终端列表 | src/terminal-utils.ts:49-62 |
| `vscode.window.tabGroups` | 访问编辑器分组和标签 | src/terminal-utils.ts:21-31 |
| `vscode.commands.registerCommand()` | 注册扩展命令 | src/extension.ts:311-542 |
| `vscode.commands.executeCommand()` | 执行 VS Code 内置命令 | src/extension.ts:412 |
| `vscode.workspace.getConfiguration()` | 读取配置 | src/extension.ts:86 |
| `vscode.window.onDidOpenTerminal` | 监听终端打开事件 | src/extension.ts:524 |
| `vscode.window.onDidCloseTerminal` | 监听终端关闭事件 | src/extension.ts:530 |
| `vscode.window.createOutputChannel()` | 创建日志通道 | src/extension.ts:216 |
| `vscode.window.createStatusBarItem()` | 创建状态栏项 | src/extension.ts:305 |
| `context.globalState` | 持久化存储扩展状态 | src/extension.ts:284, 202 |

**关键 VS Code 命令调用**：

| 命令 | 用途 | 调用位置 |
|-----|------|---------|
| `workbench.action.focusSecondEditorGroup` | 聚焦第二编辑器分组 | src/extension.ts:124 |
| `workbench.action.lockEditorGroup` | 锁定编辑器分组 | src/extension.ts:136 |
| `workbench.action.unlockEditorGroup` | 解锁编辑器分组 | src/extension.ts:129 |

### CLI Tool Dependencies

**运行时依赖的 CLI 工具**（用户需自行安装）：

| 工具 | 命令名 | npm 包名 | 安装命令 |
|-----|--------|----------|----------|
| Codebuddy | `codebuddy` | `@tencent-ai/codebuddy-code` | `npm install -g @tencent-ai/codebuddy-code` |
| Gemini CLI | `gemini` | `@google/gemini-cli` | `npm install -g @google/gemini-cli` |
| Claude Code | `claude` | `@anthropic-ai/claude-code` | `npm install -g @anthropic-ai/claude-code` |
| Codex | `codex` | `@openai/codex` | `npm install -g @openai/codex` |
| Copilot CLI | `copilot` | `@github/copilot` | `npm install -g @github/copilot` |
| Cursor CLI | `cursor-agent` | - | `curl https://cursor.com/install -fsS \| bash` |

**安装检测**：使用 `which` (Unix) 或 `where` (Windows) 命令检测 CLI 工具是否存在于 PATH

## Development and Deployment

### Local Development Setup

**前置要求**：
- Node.js 18+ 
- VS Code 1.99.0+
- npm

**安装步骤**：
```bash
# 1. 克隆仓库
git clone <public-repository-url>
cd clihub

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run compile

# 4. 在 VS Code 中打开项目
code .

# 5. 按 F5 启动扩展开发主机
```

**开发调试**：
- 按 `F5` → 启动 Extension Development Host
- 在新窗口中测试扩展功能
- 修改代码后，在调试工具栏点击 "Restart" 重新加载扩展

**常见问题**：
- **TypeScript 编译错误**：确保运行 `npm run compile` 且无错误
- **扩展未激活**：检查 `package.json` 中的 `activationEvents`

### Build and Deployment Process

**构建命令**：
```bash
# 编译 TypeScript（生成 out/ 目录）
npm run compile

# 或使用 watch 模式（自动重新编译）
npm run watch
```

**打包扩展**：
```bash
# 1. 安装 vsce（VS Code Extension Manager）
npm install -g @vscode/vsce

# 2. 打包为 .vsix 文件
vsce package

# 输出：codebuddy-terminal-editor-0.0.8.vsix
```

**安装打包后的扩展**：
```bash
# 方法 1：命令行安装
code --install-extension codebuddy-terminal-editor-0.0.8.vsix

# 方法 2：VS Code UI 安装
# Extensions 视图 → ⋯ 菜单 → Install from VSIX...
```

**发布流程**：
- 目前通过私有渠道分发
- 未来可发布到 VS Code Marketplace（需注册 publisher）

### Testing Strategy

**测试命令**：
```bash
# 运行所有测试
npm test

# 仅运行单元测试
npm run test:unit

# 仅运行集成测试
npm run test:integration
```

**测试覆盖**：
- 单元测试：36 个用例（`terminal-utils.ts` 100% 覆盖）
- 集成测试：5 个用例（终端生命周期关键场景）

**测试环境**：
- 使用真实的 VS Code Extension Host（非 mock）
- 每个测试后自动清理终端

**详细测试文档**：见 `docs/TESTING.md`

## Appendix - Useful Commands and Scripts

### Frequently Used Commands

```bash
# 开发
npm install           # 安装依赖
npm run compile       # 编译 TypeScript
npm run watch         # 监听模式编译

# 测试
npm test              # 运行所有测试
npm run test:unit     # 仅单元测试
npm run test:integration  # 仅集成测试

# 打包
vsce package          # 打包为 .vsix

# 安装
code --install-extension codebuddy-terminal-editor-0.0.8.vsix

# BMAD 相关（如使用 BMAD 代理系统）
npm run bmad:refresh  # 刷新 BMAD 配置
npm run bmad:list     # 列出可用代理
npm run bmad:validate # 验证 BMAD 配置
```

### Debugging and Troubleshooting

**查看日志**：
- 执行命令：`Codebuddy: Show Codebuddy Logs`
- 或：打开 Output 面板 → 选择 "Codebuddy Terminal"

**常见问题**：

| 问题 | 排查步骤 |
|-----|---------|
| 终端未打开 | 1. 检查日志中是否有错误<br>2. 执行 `codebuddy.refreshDetection` 重新检测安装<br>3. 检查 CLI 工具是否在 PATH 中 |
| 快捷键不工作 | 1. 检查是否有其他扩展占用 `Cmd+Shift+J`<br>2. 在键盘快捷方式设置中搜索 `codebuddy.sendPathToTerminal` |
| 终端残留/重复 | 1. 手动执行 `codebuddy.cleanStaleTerminalTabs`<br>2. 重启 VS Code<br>3. 检查日志中终端创建/销毁事件 |
| 切换工具失败 | 1. 检查新工具是否已安装（`which <tool>` 或 `where <tool>`）<br>2. 执行 `codebuddy.refreshDetection`<br>3. 查看日志中的错误信息 |

**调试技巧**：
- 启用日志自动显示：设置 `codebuddy.autoShowLogsOnStartup` 为 `true`
- 使用 Extension Development Host 调试：在源码中设置断点，按 `F5` 启动调试
- 检查终端状态：在调试控制台执行 `vscode.window.terminals`

## Enhancement Opportunities

基于已知问题和用户需求，以下是推荐的改进方向：

### 高优先级

1. **修复终端创建位置不稳定问题**
   - 实现方案：创建后验证位置，必要时移动到正确的 group
   - 影响文件：`src/extension.ts:388-415`

2. **自动清理陈旧终端**
   - 实现方案：在 `activate()` 或 `openTerminalEditor` 中自动触发 `cleanStaleTerminalTabs()`
   - 影响文件：`src/extension.ts:292, 331`

### 中优先级

3. **重构单文件架构**
   - 拆分为多个模块，提高可维护性
   - 影响文件：创建新文件 `terminal-manager.ts`, `tool-switcher.ts`, `commands.ts`

4. **改进错误处理**
   - 在 catch 块中记录错误详情
   - 影响文件：`src/extension.ts` 全文

5. **添加更多 AI 工具支持**
   - 扩展 `AI_TOOLS` 数组
   - 影响文件：`src/extension.ts:109-121`

### 低优先级

6. **移除废弃配置项**
   - 清理 `terminalCommand` 和 `terminalName` 配置
   - 影响文件：`package.json`, `src/extension.ts`

7. **添加 CI/CD**
   - 设置 GitHub Actions 自动测试
   - 影响文件：创建 `.github/workflows/test.yml`

---

**文档版本**：v1.0  
**最后更新**：2025-10-24  
**作者**：Winston (Architect Agent)  
**目标读者**：熟悉 TypeScript 但不熟悉 VS Code API 的开发者、AI Bug 修复 Agents
