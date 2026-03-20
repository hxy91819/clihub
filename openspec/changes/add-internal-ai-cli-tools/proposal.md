# Change: 增加私有环境 AI CLI 工具选项

## Why
私有环境下需要使用专用镜像与封装包，当前 CLI Hub 仅提供公共版本工具，导致相关用户无法正常安装/使用 Codex、Gemini、Claude。

## What Changes
- 新增三个独立工具选项：`codex-internal`、`gemini-internal`、`claude-internal`。
- 三个内部工具的安装包与命令分别为：
  - `<private-codex-package>` / `codex-internal`
  - `<private-gemini-package>` / `gemini-internal`
  - `<private-claude-package>` / `claude-internal`
- 内部工具的安装命令必须带私有 registry 参数。
- 公共版本工具继续保留，不做替换。
- 更新用户文档（README/CHANGELOG）。

## Impact
- Affected specs:
  - 新增 capability: `ai-tools`
- Affected code (implementation stage):
  - `src/extension.ts`（工具列表与安装映射）
  - `package.json`（如需补充说明或配置描述）
  - `README.md`、`README_EN.md`、`CHANGELOG.md`

## Open Questions
- 未来可能根据“私有环境检测”动态隐藏/显示内部工具（本期不做实现，仅保留扩展空间）。
