# Repository Guidelines

Always respond in Chinese.

## Project Structure & Module Organization
- `src/` contains the TypeScript source for the VS Code extension; `extension.ts` wires commands, terminal handling, and configuration.
- `out/` holds the compiled JavaScript emitted by the TypeScript compiler; never edit files here directly.
- `package.json` defines extension metadata, contributions, and npm scripts; `tsconfig.json` pins compiler options.
- Generated `.vsix` packages (e.g., `cli-hub-0.0.x.vsix`) live at the repo root for manual distribution.


## Build, Test, and Development Commands
```bash
npm install           # install dependencies
npm run compile       # one-off TypeScript build -> out/
npm run watch         # incremental build while developing
code --extensionDevelopmentPath=$(pwd)  # launch Extension Dev Host manually
```
Use VS Code's `Run Extension` / `F5` workflow for day-to-day debugging.

## Coding Style & Naming Conventions
- TypeScript with 2-space indentation, `strict` compiler defaults, and semicolons preserved.
- Favor descriptive camelCase for variables/functions and UPPER_SNAKE_CASE for constants (e.g., `BRACKETED_PASTE_START`).
- Keep command IDs and configuration keys under the `clihub.` namespace; mirror user-facing titles in `package.json`.
- Run `npm run compile` before committing to catch type drift.

## Testing Guidelines
- No automated test harness is present; validate changes by launching an Extension Development Host and exercising commands (`CLI Hub` palette command, `cmd/ctrl+shift+J` keybinding, installation checks).
- When feasible, add smoke coverage with `@vscode/test-electron`; keep test sources under `src/test/` and name specs `*.test.ts`.
- Document manual test scenarios in the PR description if automation is absent.

## Commit & Pull Request Guidelines
- Follow the existing history: concise, action-focused commit subjects (Chinese or English), no trailing punctuation.
- Bundle related edits per commit; avoid mixing feature work with formatting.
- For PRs, include context, screenshots or terminal captures for UX changes, and link internal tasks/issues.
- State how you validated the change (manual steps, builds) and flag any follow-up items.

## Release & Configuration Tips
- Update the version in `package.json` before packaging; regenerate the `.vsix` with `vsce package`.
- Confirm default settings (especially `clihub.terminalCommand`) remain aligned with CLI expectations before shipping.

## Agent Must-Know (Terminal Architecture)
- Terminal mode is **native-only**. Do not re-introduce `editor` mode branches.
- `clihub.terminalOpenMode` and `clihub.moveNativeTerminalToRight` are removed/deprecated; do not add them back to `package.json` contributes.
- Session routing rule is fixed: `active CLI Hub terminal > most recently active matching session > create new session`.
- `clihub.openTerminalEditor` means “open/reuse terminal”; `clihub.openNewTerminalSession` means “always create new session”.
- `clihub.switchAITool` should prefer switching CLI inside the currently active CLI Hub terminal session.
- If terminal session behavior changes, update `src/test/suite/terminal-adoption.test.ts` accordingly.

## Agent Must-Know (Docs Hygiene)
- Primary docs live under `docs/architecture/` plus `docs/README.md`.
- Historical docs are archived under `docs/archive/legacy-2026-03/` and should not be treated as the source of truth.
- When behavior/config/command changes, update current docs first; archive stale docs instead of mixing old and new narratives.

## AI Tool Support Matrix

Tool selection is defined in `src/extension.ts` via the `AI_TOOLS` list. The current built-in options are:

| Tool ID       | Display Name    | Command / Binary | Install Command or Script                          |
| ------------- | ----------------| ---------------- | -------------------------------------------------- |
| `codebuddy`   | Codebuddy       | `codebuddy`      | `npm install -g @tencent-ai/codebuddy-code`        |
| `gemini`      | Gemini CLI      | `gemini`         | `npm install -g @google/gemini-cli`                |
| `claude`      | Claude Code     | `claude`         | `npm install -g @anthropic-ai/claude-code`         |
| `codex`       | Codex           | `codex`          | `npm install -g @openai/codex`                     |
| `copilot`     | GitHub Copilot  | `copilot`        | `npm install -g @github/copilot`                   |
| `cursor-agent`| Cursor CLI      | `cursor-agent`   | `curl https://cursor.com/install -fsS \| bash`     |

Each entry may optionally declare an `installCommand`. When present (for example `cursor-agent`), the extension uses the provided script instead of composing an `npm install -g` command.
