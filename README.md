# CLI Hub: AI Tools Terminal

English | [中文](./README.zh-CN.md)

A lightweight VS Code extension that brings multiple AI CLI tools into your editor with multi-terminal sessions and active-session routing.

Download: use the GitHub Actions build artifacts or the `.vsix` asset attached to GitHub Releases.

## Features

### 1. Quick Terminal Access
- Adds an editor title bar button (terminal icon) to launch the active AI tool
- Opens the terminal in the native VS Code terminal panel by default
- `Open Terminal` reuses the active/recent CLI Hub session when possible
- `Open New Terminal Session` creates a fresh parallel CLI session
- Offers a Repair entry for Codebuddy when it is not detected (macOS/Linux only)
- Send routing: active CLI Hub terminal first, then most recently active session, else auto-create one.

### 2. Send File Paths to the AI Tool Terminal
Use the keyboard shortcut `Cmd+Shift+J` (Mac) or `Ctrl+Shift+J` (Windows/Linux) to send file information to the AI tool terminal:

**In Editor (requires editor focus):**
- **Without selection**: Sends the current file's relative path
- **With selection**: Sends the file path along with the selected line range
- Example: `@src/extension.ts L10-20 `

**Alternative Methods:**
- Right-click a file or directory in Explorer and select "Send File Path to AI Tool Terminal" (directories include trailing `/`)
- Use Command Palette: `CLI Hub: Send File Path to AI Tool Terminal`
- New session shortcut: `Cmd+Ctrl+Shift+J` (Mac) / `Ctrl+Alt+Shift+J` (Windows/Linux)

### 3. Switch Between AI Tools
- Built-in profiles for Codex, Claude Code, Codebuddy, GitHub Copilot CLI, Cursor CLI, and Gemini CLI
- Change the active tool from the status bar or with the `CLI Hub: Switch AI Tool` command. If a CLI Hub terminal is active, switching happens in that same terminal.

## Usage

1. Press `Cmd+Shift+J` / `Ctrl+Shift+J` to open the terminal and start the active CLI.
2. Once the prompt appears, press the shortcut again to send the current file/selection context.
3. You can also click the editor title bar terminal icon to open the terminal manually.

## Configuration

> `clihub.terminalOpenMode` and `clihub.moveNativeTerminalToRight` are removed.  
> Reason: editor mode introduced extra editor-group locking/layout timing complexity and made multi-session active-routing less stable. The extension is now native-only to reduce regressions.

### `clihub.toolArguments`
Configure `clihub.toolArguments` in VS Code `settings.json` (or via the Settings UI) to append extra CLI flags when the extension launches each supported tool. Every value defaults to an empty string.

#### Conservative sample (default behavior)
```json
{
  "clihub.toolArguments": {
    "codebuddy": "",
    "gemini": "",
    "claude": "",
    "codex": "",
    "copilot": "",
    "cursor-agent": ""
  }
}
```

#### YOLO profile (enable all automation flags)
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
Configure `clihub.toolEnvironments` in VS Code `settings.json` to inject per-tool environment variables (`KEY=VALUE`).

This is useful when a CLI must be launched with both env vars and flags, such as:
- Target command: `IS_SANDBOX=1 claude --dangerously-skip-permissions`
- Config approach: set env vars for `claude`, then set flags in `toolArguments`

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

### YOLO parameter reference

| Tool | Flag | Description | Risk |
|------|------|-------------|------|
| **Copilot** | `--allow-all-tools` | Grants access to every tool and system feature | High |
| **Claude** | `--dangerously-skip-permissions` | Skips permission prompts and executes automatically | High |
| **Codebuddy** | `--dangerously-skip-permissions` | Skips permission prompts and executes automatically | High |
| **Codex** | `--full-auto` | Full automation without human confirmation | High |
| **Gemini** | `--yolo` | Auto-confirms all operations | High |
| **Cursor Agent** | `--force` / `-f` | Forces command execution unless explicitly denied | High |

### Troubleshooting
1. **Invalid JSON**: Ensure double quotes are used and commas are in place.
2. **Unknown parameter**: Run `<tool> --help` to confirm the flag is supported.
3. **Flag ignored**: Close the existing terminal and relaunch it via the extension.
4. **Multiple flags**: Separate them with spaces, e.g. `"--flag1 --flag2 value"`.
5. **Whitespace inside values**: Wrap them in quotes such as `"--arg \"value with spaces\""`; VS Code preserves the quoting.

## Adding a Tool
1. Edit `config/tool-manifest.public.json` and add a new tool entry with `id`, `label`, `description`, and `command`, plus `packageName` or `installCommand` when needed.
2. For non-public builds, inject an external manifest through the release pipeline instead of committing private tool definitions to this repository.
3. Update `README.md`, `README.zh-CN.md`, and `CHANGELOG.md` so users know how the new tool is installed and used.
4. Run `npm run compile` and validate terminal routing in an Extension Development Host.

Thanks
