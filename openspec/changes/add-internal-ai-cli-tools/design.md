## Context
CLI Hub 通过工具列表与安装映射支持多种 AI CLI。私有环境用户需要使用专用封装包，并且安装必须使用指定 npm registry。

## Goals / Non-Goals
- Goals:
  - 作为独立选项提供内部版本 Codex/Gemini/Claude。
  - 内部版本保留与公共版本并行存在，不影响现有用户。
  - 安装命令必须包含指定 registry。
- Non-Goals:
  - 不实现“内网检测后自动隐藏/显示”的能力（本期仅预留空间）。
  - 不替换公共版本包名或命令。

## Decisions
- Decision: 内部工具以独立 tool id 形式新增
  - 原因：避免破坏已有配置与用户习惯；同时允许两套工具共存。
- Decision: 内部工具采用显式 installCommand
  - 原因：安装必须携带 registry 参数，不能依赖默认 npm registry。

## Risks / Trade-offs
- 工具列表增加可能导致选择更复杂。
  - Mitigation：使用清晰的 label（例如“Codex (Internal)”），并保留公共版本。

## Future Extension (Not Implemented)
- 预留根据私有环境检测自动显示内部工具的能力（例如在工具构建时根据环境策略过滤）。
