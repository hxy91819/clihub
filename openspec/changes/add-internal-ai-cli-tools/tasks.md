## 1. Implementation
- [x] 1.1 在 `src/extension.ts` 中新增三个内部工具条目（`codex-internal`/`gemini-internal`/`claude-internal`），label 清晰标识 Internal
- [x] 1.2 为内部工具补充 installCommand，确保包含私有 registry 参数
- [x] 1.3 更新 `COMMAND_TO_PACKAGE_MAP` 以保留公共与内部包映射并存
- [x] 1.4 更新 `README.md`、`README_EN.md`、`CHANGELOG.md` 说明新增内部工具与安装方式

## 2. Validation
- [ ] 2.1 运行或补充相关测试（若无现成测试则记录为手动验证）
- [ ] 2.2 手动验证：工具选择器中可见内部工具；安装提示含 registry；公共工具保持可用
