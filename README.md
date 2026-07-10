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
- Example: `src/extension.ts L10-20 `

**Alternative Methods:**
- Right-click a file or directory in Explorer and select "Send File Path to AI Tool Terminal" (directories include trailing `/`)
- Right-click in the editor or Explorer and select "Copy File Path to Clipboard" to copy the same path context without opening or sending to a terminal
- Use Command Palette: `CLI Hub: Send File Path to AI Tool Terminal`
- Use Command Palette: `CLI Hub: Copy File Path to Clipboard`
- New session shortcut: `Cmd+Ctrl+Shift+J` (Mac) / `Ctrl+Alt+Shift+J` (Windows/Linux)

### 3. Switch Between AI Tools
- Built-in profiles for Codex, OpenCode, Claude Code, Codebuddy, GitHub Copilot CLI, Cursor CLI, and Gemini CLI
- Change the active tool from the status bar or with the `CLI Hub: Switch AI Tool` command. If a CLI Hub terminal is active, switching happens in that same terminal.

## Usage

1. Press `Cmd+Shift+J` / `Ctrl+Shift+J` to open the terminal and start the active CLI.
2. Once the prompt appears, press the shortcut again to send the current file/selection context.
3. You can also click the editor title bar terminal icon to open the terminal manually.

## Configuration

> `clihub.terminalOpenMode` and `clihub.moveNativeTerminalToRight` are removed.  
> Reason: editor mode introduced extra editor-group locking/layout timing complexity and made multi-session active-routing less stable. The extension is now native-only to reduce regressions.

### `clihub.pathSendTarget`
Controls where `Send File Path to AI Tool Terminal` writes path context.

- `vscodeTerminal`: default. Uses CLI Hub's active/recent/create VS Code terminal routing.
- `iterm2`: macOS only. Writes directly to iTerm2's current session via AppleScript without using the clipboard. iTerm2 must be running, and macOS Automation permission for VS Code is required.

In a Remote SSH window, CLI Hub still runs in the remote extension host so it cannot execute local AppleScript directly. Install the companion extension `MasonHuang.cli-hub-local-bridge` locally to keep `clihub.pathSendTarget = "iterm2"` writing to your local iTerm2 current session. If the bridge is missing, CLI Hub prompts you to install it or send the same path context to the routed VS Code terminal instead.

```json
{
  "clihub.pathSendTarget": "iterm2"
}
```

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
    "opencode": "",
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
| **OpenCode** | No default preset | Check `opencode --help` and add the flags you want | Medium |
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

## Developer Install Script
`npm run install:everywhere` installs Codebuddy CLI and the selected VSIX for local/remote testing. By default, extension installation targets only VS Code (`code` locally and `.vscode-server` remotely).

To include other VS Code-like IDEs explicitly:

```bash
bash ./scripts/install-everywhere.sh --local-editors "code=VS Code,cursor=Cursor"
CLIHUB_REMOTE_SERVER_TARGETS=".vscode-server,.cursor-server" bash ./scripts/install-everywhere.sh
```

## Release Publishing
Pushing a `v*` tag runs the release workflow. It tests, packages `cli-hub-<version>-public.vsix` and `cli-hub-local-bridge-<version>-public.vsix`, uploads both to GitHub Releases, and publishes both VSIX files to the VS Code Marketplace and Open VSX when their repository secrets are configured.

Create the Marketplace token from the Visual Studio Marketplace publisher portal, then store it as a GitHub Actions repository secret named `VSCE_PAT`:

```bash
gh secret set VSCE_PAT --repo hxy91819/clihub
```

Create an Open VSX access token after signing the publisher agreement, then store it as a GitHub Actions repository secret named `OPENVSX`:

```bash
gh secret set OPENVSX --repo hxy91819/clihub
```

The release workflow creates the `MasonHuang` Open VSX namespace on the first publish if it does not already exist. Marketplace publishing runs in independent jobs, so a temporary failure in one marketplace does not block the other. Do not commit either token or paste it into workflow files.

For local debugging, use `npm run package:dev`. It generates both VSIX files with a visible prerelease version above the current patch, such as `1.4.8-dev.20260709185312` when the source version is `1.4.7`, then restores the source `package.json` files back to the normal release version. Set `CLIHUB_DEV_BUILD_LABEL=<label>` to use a readable suffix instead of the timestamp.

Use `npm run install:dev` to install the latest dev VSIX into local VS Code and the `dev-server` VS Code Server without relying on `code --remote --install-extension`. Use `npm run install:dev:cursor-main` to install only the main extension into local Cursor and the `dev-server` Cursor Server, leaving `CLI Hub Local Bridge` uninstalled for missing-bridge prompt testing.

## Supported Tools

| Tool ID | Display Name | Command | Default install command |
|------|------|------|------|
| `codebuddy` | Codebuddy | `codebuddy` | `npm install -g @tencent-ai/codebuddy-code` |
| `gemini` | Gemini CLI | `gemini` | `npm install -g @google/gemini-cli` |
| `claude` | Claude Code | `claude` | `npm install -g @anthropic-ai/claude-code` |
| `codex` | Codex | `codex` | `npm install -g @openai/codex` |
| `opencode` | OpenCode | `opencode` | `npm install -g opencode-ai` |
| `copilot` | Copilot | `copilot` | `npm install -g @github/copilot` |
| `cursor-agent` | Cursor CLI | `cursor-agent` | `curl -fsSL https://cursor.com/install \| bash` |
