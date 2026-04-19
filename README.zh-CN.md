# CLI Hub: AI Tools Terminal

[English](./README.md) | 中文

**当前版本**: cli-hub-1.4.3.vsix

一个轻量级的 VS Code 扩展，将多种 AI CLI 工具直接集成到编辑器中，支持多 Terminal 会话、激活会话路由和快速发送文件路径。

下载方式：使用 GitHub Actions 构建产物或 GitHub Releases 中的 `.vsix` 包。

## 功能特性

### 1. 快速启动终端
- 在编辑器标题栏添加终端按钮，一键启动当前选择的 AI 工具
- 默认在 VS Code 原生终端面板打开
- `Open Terminal` 优先复用当前激活/最近活跃的 CLI Hub 会话
- 新增 `Open New Terminal Session`，可并行创建多个 CLI 会话
- 自动检测当前工具是否已安装，并提供一键安装选项
- Codebuddy 未检测到安装时提供 Repair（仅 macOS/Linux），用于运行修复脚本
- 智能兼容 Python 扩展：检测到工作区存在虚拟环境时，会在启动终端前临时关闭 `python.terminal.activateEnvironment`，终端准备就绪后自动恢复；未安装 Python 扩展或工作区无虚拟环境时则完全跳过，不会触碰配置
- **发送路由规则**：优先发送到“当前激活”的 CLI Hub 终端；若不存在，则回退最近活跃会话；再不存在则自动新建会话。

### 2. 智能快捷键 `Cmd+Shift+J`
一个快捷键，两个功能，智能切换：

**场景 1：终端未打开**
- 按 `Cmd+Shift+J` (Mac) 或 `Ctrl+Shift+J` (Windows/Linux)
- 自动打开终端并启动当前选择的 AI 工具
- 提示你等待启动完成后再次按快捷键

**场景 2：终端已打开**
- 按 `Cmd+Shift+J` (Mac) 或 `Ctrl+Shift+J` (Windows/Linux)（需编辑器有焦点）
- **没有选中代码**：发送当前文件的相对路径（如 `@src/extension.ts `）
- **选中代码**：发送文件路径和选中的行号范围（如 `@src/extension.ts L10-20 `）
- 自动使用 bracketed paste 格式，保证与各种 CLI 工具的兼容性
- 新增快捷键：`Cmd+Ctrl+Shift+J` (Mac) / `Ctrl+Alt+Shift+J` (Windows/Linux) 用于强制新建会话

**其他使用方式：**
- 在编辑器中右键点击，选择"Send File Path to AI Tool Terminal"
- 在资源管理器中右键点击文件或目录，选择"Send File Path to AI Tool Terminal"（目录路径以 `/` 结尾）
- 使用命令面板：`CLI Hub: Send File Path to AI Tool Terminal`

### 3. 多 AI 工具一键切换
- 内置 Codebuddy、Gemini CLI、Claude Code、Codex、OpenCode、GitHub Copilot CLI、Cursor CLI，多工具列表随时扩展
- 状态栏显示当前工具，点击即可选择其他工具
- 提供命令面板 `CLI Hub: Switch AI Tool`，快捷切换
- 当你选择不同工具时，若当前激活的是 CLI Hub 终端，会在该终端内直接切换到新工具

## 使用方法

### 快速开始（推荐）
1. 按 `Cmd+Shift+J` / `Ctrl+Shift+J`，若终端未打开会自动创建并启动当前工具。
2. 看到 CLI 提示符后，再按一次快捷键即可发送当前文件/选区上下文。
3. 也可点击编辑器标题栏的终端按钮手动打开终端。
4. 如果你希望 CLI Hub 每次打开终端时都把面板移到右侧，可将 `clihub.nativeTerminalLocation` 设为 `right`。

## 配置选项

> `clihub.terminalOpenMode` 已移除。  
> 原因：`editor` 模式会引入分组锁定/布局时序等额外复杂度，影响多会话与激活路由稳定性；当前统一为 native-only 以降低回归风险。

### `clihub.nativeTerminalLocation`
控制 CLI Hub 原生终端的展示位置：

- `panel`：默认值，不主动改变你当前的 VS Code 面板布局
- `right`：每次 CLI Hub 打开或复用终端时，强制将面板移到右侧

```json
{
  "clihub.nativeTerminalLocation": "right"
}
```

### `clihub.toolArguments`
在 VS Code `settings.json`（或设置 UI）中配置 `clihub.toolArguments`，即可为每个支持的 AI 工具指定额外的 CLI 参数。所有值默认是空字符串，扩展在创建终端时会自动拼接这些参数。

#### 保守配置示例（默认行为）
```json
{
  "clihub.toolArguments": {
    "codebuddy": "",
    "gemini": "",
    "claude": "",
    "codex": "",
    "opencode": "",
    "copilot": "",
    "cursor-agent": ""
  }
}
```

#### YOLO 模式配置示例（所有工具启用）
```json
{
  "clihub.toolArguments": {
    "codebuddy": "--dangerously-skip-permissions",
    "gemini": "--yolo",
    "claude": "--dangerously-skip-permissions",
    "codex": "--full-auto",
    "copilot": "--allow-all-tools",
    "cursor-agent": "--force"
  }
}
```

### `clihub.toolEnvironments`
在 VS Code `settings.json` 中配置 `clihub.toolEnvironments`，即可按 AI 工具注入环境变量（`KEY=VALUE`）。

```json
{
  "clihub.toolEnvironments": {
    "claude": {
      "IS_SANDBOX": "1"
    }
  },
  "clihub.toolArguments": {
    "claude": "--dangerously-skip-permissions"
  }
}
```

## 如何添加新的工具
1. 编辑 `config/tool-manifest.public.json`，添加新的工具条目（`id`、`label`、`description`、`command`，必要时追加 `packageName` 或 `installCommand`）。
2. 如需构建非公开版工具集，在 release 流程中通过 `--tool-manifest` 注入外部 manifest，不要把私有工具定义提交到开源仓库。
3. 更新 `README.md`、`README.zh-CN.md`、`CHANGELOG.md` 等文档，确保用户了解新工具的支持与安装方式。
4. 运行 `npm run compile` 确认类型检查通过，并在扩展开发主机中手动验证终端切换逻辑。

## 当前内置工具

| Tool ID | 显示名称 | 命令 | 默认安装命令 |
|------|------|------|------|
| `codebuddy` | Codebuddy | `codebuddy` | `npm install -g @tencent-ai/codebuddy-code` |
| `gemini` | Gemini CLI | `gemini` | `npm install -g @google/gemini-cli` |
| `claude` | Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` |
| `codex` | Codex | `codex` | `npm install -g @openai/codex` |
| `opencode` | OpenCode | `opencode` | `npm install -g opencode-ai` |
| `copilot` | GitHub Copilot CLI | `copilot` | `npm install -g @github/copilot` |
| `cursor-agent` | Cursor CLI | `cursor-agent` | `curl -fsSL https://cursor.com/install \| bash` |
