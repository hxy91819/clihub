# High Level Architecture

## Technical Summary

这是一个**轻量级 VS Code 扩展**，专注于提供流畅的 AI CLI 工具集成体验。核心价值在于：
1. 一键启动多种 AI CLI 工具（Codebuddy、Gemini、Claude 等）
2. 智能终端生命周期管理，避免重复创建
3. 快捷键快速发送文件路径到 AI 工具

**架构特点**：
- 单文件设计（`src/extension.ts`）包含所有核心逻辑
- 状态驱动的终端管理
- 事件监听式的终端追踪
- 无外部运行时依赖（仅开发时依赖）

## Actual Tech Stack

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

## Repository Structure Reality Check

- **类型**: 单一仓库（Monorepo 架构，但仅包含一个扩展）
- **包管理器**: npm
- **构建输出**: `out/` 目录（TypeScript 编译后的 JS 文件）
- **版本控制**: Git（仓库地址已在公开版本中脱敏）
