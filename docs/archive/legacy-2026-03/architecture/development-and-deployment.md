# Development and Deployment

## Local Development Setup

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

## Build and Deployment Process

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

## Testing Strategy

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
