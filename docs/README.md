# Docs Index

本文档目录已于 2026-03 进行一次清理，目标是让文档与当前代码实现保持一致，减少历史噪音。

## 当前有效文档

- `docs/development-and-release.md`：本地开发、测试安装、工具清单扩展与双市场发布流程
- `docs/release-guardrails.md`：发布复盘、自动校验范围、故障判断与规避策略
- `docs/architecture/index.md`：架构总览入口
- `docs/architecture/quick-reference-key-files-and-entry-points.md`：关键文件与命令入口速查
- `docs/architecture/core-architecture-terminal-lifecycle-management.md`：终端生命周期与会话模型
- `docs/architecture/terminal-session-routing-native-mode.md`：native-only + 多会话路由规则
- `docs/architecture/data-models-and-apis.md`：配置、命令、会话数据模型
- `docs/architecture/multi-tool-switching-architecture.md`：工具切换流程

## 归档文档

历史 PRD、QA、Stories、旧架构草稿已归档到：

- `docs/archive/legacy-2026-03/`

归档内容仅供追溯，不作为当前实现依据。

## 维护约定

- 任何终端会话/路由行为变更，必须同步更新 `docs/architecture/terminal-session-routing-native-mode.md`。
- 新增命令或配置时，必须同步更新 `docs/architecture/data-models-and-apis.md`。
- 大版本行为调整后，优先更新当前文档；历史文档进入归档，不在主目录继续叠加。
- 根目录 `README.md` / `README.zh-CN.md` 会展示在扩展市场，只保留面向插件用户的功能、使用和配置说明；开发与发布内容维护在 `docs/`。
- 发布相关改动必须运行 `npm run validate:release`；新增发布约束时同步更新校验脚本和 `docs/release-guardrails.md`。
