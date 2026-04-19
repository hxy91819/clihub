# Codebuddy Terminal Editor Extension

This is a VS Code extension that integrates Codebuddy Code (and other AI CLI tools) directly into the editor. It provides a one-click terminal launcher with smart file path sending capabilities.

## Essential Development Commands

### Build & Development
```bash
npm install           # Install dependencies
npm run compile       # One-time TypeScript compilation to out/
npm run watch         # Incremental build during development
```

### Testing & Debugging
- Press `F5` in VS Code to launch Extension Development Host
- Or use "Run Extension" from the Run and Debug view
- No automated test suite exists; validate changes manually in the Extension Development Host

### Packaging & Distribution
```bash
npm install -g @vscode/vsce
vsce package          # Creates .vsix file for distribution
```

Install the packaged extension:
```bash
code --install-extension codebuddy-terminal-editor-0.0.x.vsix
```

## Architecture Overview

### Core Modules
- **src/extension.ts**: Single-file extension containing all logic
  - Terminal lifecycle management (creation, reuse, disposal)
  - Command registration (open terminal, send file paths)
  - Installation detection for CLI commands
  - Terminal classification (match, stale, none) to handle workspace reloads
  - Bracketed paste formatting for CLI compatibility

### Key Design Patterns

**Terminal State Management**:
- Tracks active Codebuddy terminal via `codebuddyTerminal` global
- Uses `CODEBUDDY_TERMINAL_ENV_KEY` environment variable to identify extension-created terminals
- Implements `resolveCodebuddyTerminal()` to handle workspace reload scenarios where terminals are revived by VS Code
- Classifies terminals as 'match' (valid), 'stale' (outdated config), or 'none' (unrelated)

**Configuration System**:
- Reads from `codebuddy.*` namespace in VS Code settings
- Supports custom CLI commands (not just 'codebuddy') via `codebuddy.terminalCommand`
- Maps commands to npm packages via `COMMAND_TO_PACKAGE_MAP` for installation prompts

**Smart Terminal Cleanup**:
- Automatically detects and removes stale shell tabs (zsh, bash, etc.) when opening Codebuddy terminal
- Configurable via `codebuddy.autoCleanStaleTerminalTabs` (off/prompt/auto)
- Uses tab label heuristics to identify common shell names

**File Path Sending** (`Cmd+Shift+J`):
- If terminal doesn't exist: opens new terminal and prompts user to wait for startup
- If terminal exists: sends `@relative/path` or `@relative/path L10-20` (with selection)
- Uses bracketed paste mode (`\x1b[200~...\x1b[201~`) for compatibility with various CLIs

**Installation Detection**:
- Checks CLI command existence on first use via `which`/`where`
- Caches result in extension's global state
- Offers one-click npm global installation if missing

### Extension Contributions (package.json)

**Commands**:
- `codebuddy.openTerminalEditor` - Opens/shows Codebuddy terminal
- `codebuddy.sendPathToTerminal` - Smart keybinding for file path sending
- `codebuddy.refreshDetection` - Re-checks CLI installation status
- `codebuddy.cleanStaleTerminalTabs` - Manual cleanup of stale shells
- `codebuddy.showLogs` - Opens LogOutputChannel

**Configuration**:
- `codebuddy.terminalCommand` (default: "codebuddy") - CLI command to execute
- `codebuddy.autoShowLogsOnStartup` (default: false) - Auto-show logs on activation
- `codebuddy.autoCleanStaleTerminalTabs` (default: "prompt") - Cleanup mode

**Keybindings**:
- `Cmd+Shift+J` (Mac) / `Ctrl+Shift+J` (Windows/Linux) - Triggers `sendPathToTerminal`

**UI Integration**:
- Editor title bar button (terminal icon) - Triggers `openTerminalEditor`
- Context menus in editor and explorer for sending file paths

## Code Style & Conventions

- TypeScript with strict mode enabled
- 2-space indentation (per existing code)
- Use camelCase for variables/functions, UPPER_SNAKE_CASE for constants
- Preserve semicolons
- Keep command IDs under `codebuddy.*` namespace
- Extensive use of try-catch with log statements (use `try { log.info(...) } catch { /* ignore */ }` pattern)
- Always run `npm run compile` before committing to catch type errors

## Important Notes

- **Terminal Location**: Creates terminals in `vscode.ViewColumn.Beside` to open alongside current editor
- **Group Locking**: Automatically locks the editor group after terminal creation to prevent replacement
- **Bracketed Paste**: Required for compatibility with Gemini CLI and similar tools
- **Workspace State**: Handles VS Code's terminal revival on workspace reload by classifying terminals
- **No Tests**: Extension lacks automated tests; rely on manual testing in Extension Development Host
