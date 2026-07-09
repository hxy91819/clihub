import * as vscode from 'vscode';
import { exec, execFile } from 'child_process';
import * as path from 'path';
import { summarizeTerminalOptions, getTerminalOptions } from './terminal-utils';
// Story 1.4: Argument parsing moved into a dedicated module for reuse and testability
import { parseArgumentsString, hasUnmatchedQuotes } from './argument-parser';
import { loadToolManifest, ToolManifestEntry } from './tool-manifest';
import {
  describeSelectionSource,
  getToolSelectionSnapshot,
  getToolIdForWorkspace,
  hasWorkspaceOverride,
  migrateLegacyToolSelection,
  WORKSPACE_TOOL_KEY,
  GLOBAL_DEFAULT_TOOL_KEY,
} from './tool-selection';

let codebuddyTerminal: vscode.Terminal | undefined;
let codebuddyInstallationChecked = false;
let codebuddyInstalled = false;
let isOpeningTerminal = false;
let log: vscode.LogOutputChannel;
let statusBarItem: vscode.StatusBarItem | undefined;
let currentToolId: string = 'codebuddy';
let extensionContextRef: vscode.ExtensionContext | undefined;
let pythonActivationPreviousValue: unknown;
let pythonActivationDidUpdate = false;
let pythonActivationRestoreTimer: NodeJS.Timeout | undefined;
let pythonActivationToggleToken = 0;
let pythonUsageDetectionCache: boolean | undefined;
let lastActiveCliHubTerminal: vscode.Terminal | undefined;

interface TerminalSessionMeta {
  terminal: vscode.Terminal;
  toolId: string;
  workspacePath?: string;
  createdAt: number;
  lastActiveAt: number;
}

const sessionRegistry = new Map<vscode.Terminal, TerminalSessionMeta>();

// Bracketed paste 序列常量
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const CLIHUB_TERMINAL_ENV_KEY = 'CLIHUB_TERMINAL';
const CLIHUB_TERMINAL_ENV_VALUE = '1';
const CLIHUB_TOOL_ENV_KEY = 'CLIHUB_TOOL_ID';
const CLIHUB_TOOL_ENV_SIGNATURE_KEY = 'CLIHUB_TOOL_ENV_SIGNATURE';
const CLIHUB_WORKSPACE_ENV_KEY = 'CLIHUB_WORKSPACE_PATH';
const CLIHUB_CONFIG_SECTION = 'clihub';
const PYTHON_CONFIG_SECTION = 'python';
const PYTHON_TERMINAL_ACTIVATE_SETTING = 'terminal.activateEnvironment';
const PYTHON_ACTIVATION_RESET_DELAY_MS = 500;
const PYTHON_EXTENSION_ID = 'ms-python.python';
const PANEL_POSITION_RIGHT_COMMAND = 'workbench.action.positionPanelRight';
const LOCAL_BRIDGE_WRITE_COMMAND = 'clihubLocal.writeToIterm2';
const LOCAL_BRIDGE_EXTENSION_ID = 'MasonHuang.cli-hub-local-bridge';
const ITERM2_WRITE_TEXT_SCRIPT = [
  'on run argv',
  '  if (count of argv) is 0 then error "Missing text to write."',
  '  set textToWrite to item 1 of argv',
  '  tell application "iTerm2"',
  '    activate',
  '    if (count of windows) is 0 then error "No iTerm2 windows are open."',
  '    tell current session of current window',
  '      write text textToWrite newline NO',
  '    end tell',
  '  end tell',
  'end run'
].join('\n');

/**
 * Configuration interface for custom CLI arguments per AI tool.
 * Used in Story 1.2 to inject arguments during terminal creation.
 */
type ToolArgumentsConfig = Record<string, string>;

type ToolEnvironmentValues = Record<string, string>;

type ToolEnvironmentsConfig = Record<string, ToolEnvironmentValues>;

type CodebuddyTerminalOptions = vscode.TerminalOptions & { isTransient?: boolean };
type NativeTerminalLocation = 'panel' | 'right';
type AIToolDescriptor = ToolManifestEntry;
type SelectionLike = Pick<vscode.Selection, 'isEmpty' | 'start' | 'end'>;
type PathSendTarget = 'vscodeTerminal' | 'iterm2';

let availableTools: AIToolDescriptor[] = [];
let manifestTools: AIToolDescriptor[] = [];

function getToolEnvironmentVariables(toolId: string): Record<string, string> {
  const envConfig = getConfigValue<ToolEnvironmentsConfig>('toolEnvironments', {});
  const selected = envConfig?.[toolId as keyof ToolEnvironmentsConfig];

  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(selected)) {
    if (!key || typeof value !== 'string') {
      try {
        log.warn(`[CLI Hub] Ignored invalid environment entry for ${toolId}: key=${key}, valueType=${typeof value}`);
      } catch { /* ignore */ }
      continue;
    }
    normalized[key] = value;
  }

  return normalized;
}

function buildToolEnvironmentSignature(toolId: string): string {
  const entries = Object.entries(getToolEnvironmentVariables(toolId))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return entries.map(([key, value]) => `${key}=${value}`).join('\n');
}

function normalizeWorkspacePath(workspacePath: string | vscode.Uri | undefined): string | undefined {
  if (!workspacePath) {
    return undefined;
  }

  if (typeof workspacePath === 'string') {
    return workspacePath;
  }

  return workspacePath.fsPath;
}

// 包装文本为 bracketed paste 格式（用于 Gemini CLI 兼容）
function wrapWithBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}

export function buildPathContextText(relativePath: string, isDirectory: boolean, selection?: SelectionLike): string {
  if (selection && !selection.isEmpty && !isDirectory) {
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;
    return `${relativePath} L${startLine}-${endLine} `;
  }

  if (isDirectory) {
    const dirPath = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
    return `${dirPath} `;
  }

  return `${relativePath} `;
}

export function buildIterm2WriteTextArgs(text: string): string[] {
  return ['-e', ITERM2_WRITE_TEXT_SCRIPT, text];
}

export function shouldUseLocalIterm2Bridge(pathSendTarget: PathSendTarget, remoteName: string | undefined): boolean {
  return pathSendTarget === 'iterm2' && Boolean(remoteName);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function disablePythonTerminalAutoActivation(): Promise<{ token: number; changed: boolean }> {
  pythonActivationToggleToken += 1;
  const token = pythonActivationToggleToken;

  const pythonExtension = vscode.extensions.getExtension(PYTHON_EXTENSION_ID);
  if (!pythonExtension) {
    try { log?.debug('[CLI Hub] Python extension not detected; skipping auto activation toggle'); } catch { /* ignore */ }
    return { token, changed: false };
  }

  const pythonUsage = await detectPythonUsageInWorkspace();
  if (!pythonUsage) {
    try { log?.debug('[CLI Hub] No virtual environment detected; skipping auto activation toggle'); } catch { /* ignore */ }
    return { token, changed: false };
  }

  if (pythonActivationDidUpdate) {
    return { token, changed: true };
  }

  try {
    const config = vscode.workspace.getConfiguration(PYTHON_CONFIG_SECTION);
    pythonActivationPreviousValue = config.get(PYTHON_TERMINAL_ACTIVATE_SETTING);
    if (pythonActivationPreviousValue === false) {
      pythonActivationPreviousValue = undefined;
      return { token, changed: false };
    }

    await config.update(PYTHON_TERMINAL_ACTIVATE_SETTING, false, vscode.ConfigurationTarget.Workspace);
    pythonActivationDidUpdate = true;
    try { log?.debug('[CLI Hub] Temporarily disabled python.terminal.activateEnvironment'); } catch { /* ignore */ }
    return { token, changed: true };
  } catch (error) {
    pythonActivationPreviousValue = undefined;
    pythonActivationDidUpdate = false;
    try { log?.warn(`[CLI Hub] Failed to disable python.terminal.activateEnvironment: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    return { token, changed: false };
  }
}

async function detectPythonUsageInWorkspace(): Promise<boolean> {
  if (pythonUsageDetectionCache !== undefined) {
    return pythonUsageDetectionCache;
  }

  const includeGlobs = [
    '**/{.venv,venv,env,pyenv}/pyvenv.cfg',
    '**/{.venv,venv,env,pyenv}/bin/activate',
    '**/{.venv,venv,env,pyenv}/Scripts/activate'
  ];
  const excludeGlob = '**/{node_modules,.git,.hg,.svn,.cache,.idea,.vs,.vscode}/**';

  for (const pattern of includeGlobs) {
    try {
      const matches = await vscode.workspace.findFiles(pattern, excludeGlob, 1);
      if (matches.length > 0) {
        pythonUsageDetectionCache = true;
        return true;
      }
    } catch { /* ignore */ }
  }

  pythonUsageDetectionCache = false;
  return false;
}

function schedulePythonTerminalActivationRestore(token: number, changed: boolean): void {
  if (!changed) {
    return;
  }

  if (pythonActivationRestoreTimer) {
    clearTimeout(pythonActivationRestoreTimer);
  }

  pythonActivationRestoreTimer = setTimeout(async () => {
    if (pythonActivationToggleToken !== token) {
      return;
    }
    pythonActivationRestoreTimer = undefined;
    if (!pythonActivationDidUpdate) {
      pythonActivationPreviousValue = undefined;
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration(PYTHON_CONFIG_SECTION);
      await config.update(
        PYTHON_TERMINAL_ACTIVATE_SETTING,
        pythonActivationPreviousValue as boolean | undefined,
        vscode.ConfigurationTarget.Workspace
      );
      try { log?.debug('[CLI Hub] Restored python.terminal.activateEnvironment to previous value'); } catch { /* ignore */ }
    } catch (error) {
      try { log?.warn(`[CLI Hub] Failed to restore python.terminal.activateEnvironment: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    } finally {
      pythonActivationDidUpdate = false;
      pythonActivationPreviousValue = undefined;
    }
  }, PYTHON_ACTIVATION_RESET_DELAY_MS);
}

async function restorePythonTerminalActivationImmediately(): Promise<void> {
  pythonActivationToggleToken += 1;
  if (pythonActivationRestoreTimer) {
    clearTimeout(pythonActivationRestoreTimer);
    pythonActivationRestoreTimer = undefined;
  }

  if (!pythonActivationDidUpdate) {
    pythonActivationPreviousValue = undefined;
    return;
  }

  try {
    const config = vscode.workspace.getConfiguration(PYTHON_CONFIG_SECTION);
    await config.update(
      PYTHON_TERMINAL_ACTIVATE_SETTING,
      pythonActivationPreviousValue as boolean | undefined,
      vscode.ConfigurationTarget.Workspace
    );
    try { log?.debug('[CLI Hub] Restored python.terminal.activateEnvironment immediately'); } catch { /* ignore */ }
  } catch (error) {
    try { log?.warn(`[CLI Hub] Failed to restore python.terminal.activateEnvironment immediately: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
  } finally {
    pythonActivationDidUpdate = false;
    pythonActivationPreviousValue = undefined;
  }
}

function isConfigValueExplicitlySet<T>(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect<T>(key);
  return inspected?.workspaceFolderValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.globalValue !== undefined;
}

function getConfigValue<T>(key: string, defaultValue: T): T {
  const newConfig = vscode.workspace.getConfiguration(CLIHUB_CONFIG_SECTION);
  if (isConfigValueExplicitlySet<T>(newConfig, key)) {
    return newConfig.get<T>(key, defaultValue) as T;
  }

  return newConfig.get<T>(key, defaultValue) as T;
}

function getAvailableTools(): ReadonlyArray<AIToolDescriptor> {
  return availableTools;
}

function getToolById(toolId: string): AIToolDescriptor | undefined {
  return getAvailableTools().find(tool => tool.id === toolId);
}

function getFallbackToolId(): string {
  return getAvailableTools()[0]?.id ?? 'codebuddy';
}

function getConfiguredDefaultToolId(): string {
  const configured = getConfigValue<string>('terminalCommand', getFallbackToolId());
  return getToolById(configured)?.id ?? getFallbackToolId();
}

function buildToolSelectionOptions(context: vscode.ExtensionContext) {
  return {
    context,
    tools: getAvailableTools(),
    defaultToolId: getConfiguredDefaultToolId(),
    log,
  };
}

function resolveToolSelectionSnapshot(context: vscode.ExtensionContext) {
  return getToolSelectionSnapshot(buildToolSelectionOptions(context));
}

function resolveToolId(context: vscode.ExtensionContext) {
  return getToolIdForWorkspace(buildToolSelectionOptions(context));
}

function isCodebuddyTerminal(terminal: vscode.Terminal | undefined): boolean {
  if (!terminal) return false;
  try {
    const options = terminal.creationOptions as vscode.TerminalOptions | vscode.ExtensionTerminalOptions;
    if (options && 'pty' in options) {
      return false;
    }
    const env = (options as vscode.TerminalOptions | undefined)?.env as Record<string, string | undefined> | undefined;
    return env?.[CLIHUB_TERMINAL_ENV_KEY] === CLIHUB_TERMINAL_ENV_VALUE;
  } catch { /* ignore */ }
  return false;
}

function getTerminalToolId(terminal: vscode.Terminal): string | undefined {
  const meta = sessionRegistry.get(terminal);
  if (meta) {
    return meta.toolId;
  }
  try {
    const options = getTerminalOptions(terminal);
    const env = (options?.env ?? {}) as Record<string, string | undefined>;
    return env[CLIHUB_TOOL_ENV_KEY];
  } catch { /* ignore */ }
  return undefined;
}

function getTerminalWorkspacePath(terminal: vscode.Terminal): string | undefined {
  const meta = sessionRegistry.get(terminal);
  if (meta?.workspacePath) {
    return meta.workspacePath;
  }

  try {
    const options = getTerminalOptions(terminal);
    const env = (options?.env ?? {}) as Record<string, string | undefined>;
    return env[CLIHUB_WORKSPACE_ENV_KEY] ?? normalizeWorkspacePath(options?.cwd);
  } catch { /* ignore */ }

  return undefined;
}

function getTerminalToolEnvironmentSignature(terminal: vscode.Terminal): string {
  try {
    const options = getTerminalOptions(terminal);
    const env = (options?.env ?? {}) as Record<string, string | undefined>;
    return env[CLIHUB_TOOL_ENV_SIGNATURE_KEY] ?? '';
  } catch { /* ignore */ }

  return '';
}

function registerSession(terminal: vscode.Terminal, toolId: string, workspacePath?: string): void {
  const now = Date.now();
  const existing = sessionRegistry.get(terminal);
  sessionRegistry.set(terminal, {
    terminal,
    toolId,
    workspacePath: workspacePath ?? existing?.workspacePath ?? getTerminalWorkspacePath(terminal),
    createdAt: existing?.createdAt ?? now,
    lastActiveAt: now,
  });
  codebuddyTerminal = terminal;
}

function removeSession(terminal: vscode.Terminal): void {
  sessionRegistry.delete(terminal);
  if (lastActiveCliHubTerminal === terminal) {
    lastActiveCliHubTerminal = undefined;
  }
  if (codebuddyTerminal === terminal) {
    codebuddyTerminal = undefined;
  }
}

function touchSession(terminal: vscode.Terminal): void {
  const existing = sessionRegistry.get(terminal);
  if (!existing) {
    const fallbackTool = getTerminalToolId(terminal) ?? currentToolId;
    registerSession(terminal, fallbackTool, getTerminalWorkspacePath(terminal));
    return;
  }
  existing.lastActiveAt = Date.now();
  codebuddyTerminal = terminal;
}

function refreshSessionRegistryFromWindow(): void {
  const liveTerminals = new Set(vscode.window.terminals.filter(t => !t.exitStatus));

  for (const [terminal] of sessionRegistry) {
    if (!liveTerminals.has(terminal)) {
      removeSession(terminal);
    }
  }

  for (const terminal of liveTerminals) {
    if (!isCodebuddyTerminal(terminal)) {
      continue;
    }
    const toolId = getTerminalToolId(terminal) ?? currentToolId;
    if (!sessionRegistry.has(terminal)) {
      registerSession(terminal, toolId, getTerminalWorkspacePath(terminal));
    }
  }
}

function workspacePathMatchesTerminal(terminal: vscode.Terminal, workspacePath: string | undefined): boolean {
  const terminalWorkspacePath = getTerminalWorkspacePath(terminal);
  return (terminalWorkspacePath ?? '') === (workspacePath ?? '');
}

function terminalMatchesPreparedToolContext(terminal: vscode.Terminal, toolId: string, workspacePath: string | undefined): boolean {
  if (!workspacePathMatchesTerminal(terminal, workspacePath)) {
    return false;
  }

  return getTerminalToolEnvironmentSignature(terminal) === buildToolEnvironmentSignature(toolId);
}

function getMostRecentlyActiveSession(toolId: string, workspacePath: string | undefined): vscode.Terminal | undefined {
  let best: TerminalSessionMeta | undefined;
  for (const session of sessionRegistry.values()) {
    if (session.terminal.exitStatus) {
      continue;
    }
    if (session.toolId !== toolId) {
      continue;
    }
    if ((session.workspacePath ?? '') !== (workspacePath ?? '')) {
      continue;
    }
    if (!terminalMatchesPreparedToolContext(session.terminal, toolId, workspacePath)) {
      continue;
    }
    if (!best || session.lastActiveAt > best.lastActiveAt) {
      best = session;
    }
  }
  return best?.terminal;
}

function findActiveCliHubTerminal(toolId: string, workspacePath: string | undefined): vscode.Terminal | undefined {
  const active = vscode.window.activeTerminal;
  if (!active || active.exitStatus || !isCodebuddyTerminal(active)) {
    return undefined;
  }
  const activeTool = getTerminalToolId(active);
  if (!activeTool || activeTool !== toolId) {
    return undefined;
  }
  if (!terminalMatchesPreparedToolContext(active, toolId, workspacePath)) {
    return undefined;
  }
  touchSession(active);
  lastActiveCliHubTerminal = active;
  return active;
}

function resolveTargetTerminalForSend(toolId: string): vscode.Terminal | undefined {
  refreshSessionRegistryFromWindow();
  const workspacePath = getCurrentWorkspacePath();
  const active = findActiveCliHubTerminal(toolId, workspacePath);
  if (active) {
    return active;
  }
  const recent = getMostRecentlyActiveSession(toolId, workspacePath);
  if (recent) {
    touchSession(recent);
    return recent;
  }
  return undefined;
}

// 根据命令获取对应的安装命令
function getInstallCommand(command: string): string {
  const tool = getToolById(command);
  if (tool?.installCommand) {
    return tool.installCommand;
  }

  const packageName = tool?.packageName || tool?.command || command;
  return `npm install -g ${packageName}`;
}

function getToolLabel(toolId: string): string {
  const tool = getToolById(toolId);
  return tool?.label || toolId;
}

function updateStatusBar(toolId: string, context: vscode.ExtensionContext) {
  if (!statusBarItem) {
    return;
  }
  const label = getToolLabel(toolId);
  const selection = resolveToolSelectionSnapshot(context);
  const icon = selection.source === 'workspace'
    ? '$(folder)'
    : selection.source === 'global'
      ? '$(globe)'
      : '$(settings-gear)';
  const sourceText = selection.source === 'workspace'
    ? 'workspace-specific'
    : selection.source === 'global'
      ? 'global default'
      : 'extension default';
  statusBarItem.text = `$(terminal) ${label} ${icon}`.trim();
  statusBarItem.tooltip = `Current AI Tool: ${label} (${sourceText}). Click to switch.`;
}

async function selectAITool(context: vscode.ExtensionContext): Promise<string | undefined> {
  const selection = resolveToolSelectionSnapshot(context);
  const currentTool = selection.toolId;

  const items = getAvailableTools().map(tool => {
    let detail: string | undefined;
    if (tool.id === currentTool) {
      detail = `$(check) Currently selected (${describeSelectionSource(selection.source)})`;
    }
    return {
      label: tool.label,
      description: tool.description,
      detail,
      toolId: tool.id,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an AI tool for this workspace',
    title: 'Switch AI Tool',
  });

  if (selected) {
    await context.workspaceState.update(WORKSPACE_TOOL_KEY, selected.toolId);
    updateStatusBar(selected.toolId, context);
    try { log.info(`[CLI Hub] Tool set for this workspace: ${selected.toolId}`); } catch { /* ignore */ }
    return selected.toolId;
  }

  return undefined;
}

// 初始化日志通道
// 说明：使用 LogOutputChannel 以支持日志级别过滤；默认会在启动时后台显示，便于快速查看
function initLogger() {
  if (!log) {
    // 创建“Log (CLI Hub Terminal)”通道
    log = vscode.window.createOutputChannel('CLI Hub Terminal', { log: true });
    // 启动时默认不自动展示日志窗口，避免打扰用户
    try {
      const autoShow = getConfigValue<boolean>('autoShowLogsOnStartup', false) === true;
      if (autoShow) {
        // 后台显示（不抢焦点）
        try { log.show(true); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    try { log.info('[CLI Hub] Logger initialized'); } catch { /* ignore */ }
  }
}


function getCurrentWorkspacePath(): string | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const workspace = activeUri
    ? vscode.workspace.getWorkspaceFolder(activeUri)
    : (vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined);
  return workspace?.uri.fsPath;
}

function getCustomArgsString(toolId: string, warnUser: boolean): string {
  const toolArgs = getConfigValue<ToolArgumentsConfig>('toolArguments', {});
  const customArgsString = toolArgs[toolId] || '';
  if (customArgsString.length > 1000 && warnUser) {
    vscode.window.showWarningMessage(
      `Custom arguments for ${getToolLabel(toolId)} are very long (${customArgsString.length} chars). This may cause issues.`
    );
  }

  try {
    const hasUnmatchedQuote = hasUnmatchedQuotes(customArgsString);
    parseArgumentsString(customArgsString, log);
    if (hasUnmatchedQuote && warnUser) {
      vscode.window.showWarningMessage(
        `Arguments for ${getToolLabel(toolId)} have unmatched quotes. Parsing may be incorrect.`
      );
    }
  } catch (error) {
    try { log.error(`[CLI Hub] Failed to parse arguments: ${error}`); } catch { /* ignore */ }
    if (warnUser) {
      vscode.window.showErrorMessage('Failed to parse custom arguments. Using default configuration.');
    }
  }

  return customArgsString;
}

function getStartCommandForTool(toolId: string, warnUser: boolean): string {
  const customArgsString = getCustomArgsString(toolId, warnUser);
  const command = getToolById(toolId)?.command || toolId;
  return customArgsString.trim().length > 0 ? `${command} ${customArgsString}` : command;
}

function getNativeTerminalLocation(): NativeTerminalLocation {
  const location = getConfigValue<NativeTerminalLocation>('nativeTerminalLocation', 'panel');
  return location === 'right' ? 'right' : 'panel';
}

function getPathSendTarget(): PathSendTarget {
  const target = getConfigValue<PathSendTarget>('pathSendTarget', 'vscodeTerminal');
  return target === 'iterm2' ? 'iterm2' : 'vscodeTerminal';
}

async function applyNativeTerminalLocationPreference(): Promise<void> {
  if (getNativeTerminalLocation() !== 'right') {
    return;
  }

  try {
    await vscode.commands.executeCommand(PANEL_POSITION_RIGHT_COMMAND);
  } catch (error) {
    try {
      log.warn(`[CLI Hub] Failed to move terminal panel to the right: ${error instanceof Error ? error.message : String(error)}`);
    } catch { /* ignore */ }
  }
}

function createCliHubTerminal(toolId: string, workspacePath: string | undefined): vscode.Terminal {
  const toolEnvSignature = buildToolEnvironmentSignature(toolId);
  const options: CodebuddyTerminalOptions = {
    name: getToolLabel(toolId),
    env: {
      [CLIHUB_TERMINAL_ENV_KEY]: CLIHUB_TERMINAL_ENV_VALUE,
      [CLIHUB_TOOL_ENV_KEY]: toolId,
      [CLIHUB_TOOL_ENV_SIGNATURE_KEY]: toolEnvSignature,
      [CLIHUB_WORKSPACE_ENV_KEY]: workspacePath ?? '',
      ...getToolEnvironmentVariables(toolId),
    },
    cwd: workspacePath,
    location: vscode.TerminalLocation.Panel,
  };
  const terminal = vscode.window.createTerminal(options);
  registerSession(terminal, toolId, workspacePath);
  try {
    log.info('[CLI Hub] Created new terminal session');
    log.debug(`[CLI Hub] Terminal options: ${summarizeTerminalOptions(options)}`);
  } catch { /* ignore */ }
  return terminal;
}

function resolveTerminalForOpen(toolId: string, forceNew: boolean, workspacePath: string | undefined): { terminal: vscode.Terminal; created: boolean } {
  refreshSessionRegistryFromWindow();
  if (!forceNew) {
    const active = findActiveCliHubTerminal(toolId, workspacePath);
    if (active) {
      return { terminal: active, created: false };
    }
    const recent = getMostRecentlyActiveSession(toolId, workspacePath);
    if (recent) {
      touchSession(recent);
      return { terminal: recent, created: false };
    }
  }
  return { terminal: createCliHubTerminal(toolId, workspacePath), created: true };
}

function getActiveCliHubTerminalAnyTool(): vscode.Terminal | undefined {
  const active = vscode.window.activeTerminal;
  if (!active || active.exitStatus || !isCodebuddyTerminal(active)) {
    return undefined;
  }
  touchSession(active);
  lastActiveCliHubTerminal = active;
  return active;
}

async function switchCliInTerminal(terminal: vscode.Terminal, nextToolId: string): Promise<boolean> {
  try {
    terminal.show(true);
    terminal.sendText('\u0003', false);
    await delay(120);
    // Some interactive CLIs need a second interrupt to fully return to shell prompt.
    terminal.sendText('\u0003', false);
    await delay(120);
    const startCommand = getStartCommandForTool(nextToolId, true);
    terminal.sendText(startCommand, true);
    registerSession(terminal, nextToolId);
    try { log.info(`[CLI Hub] Switched active terminal to tool=${nextToolId}`); } catch { /* ignore */ }
    return true;
  } catch (error) {
    try { log.error(`[CLI Hub] Failed to switch CLI in terminal: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    return false;
  }
}

function resolvePathTarget(uri?: vscode.Uri): { targetUri?: vscode.Uri; selection?: vscode.Selection } {
  let targetUri: vscode.Uri | undefined = uri;
  let capturedSelection: vscode.Selection | undefined;

  if (!targetUri) {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.scheme === 'file') {
      targetUri = activeEditor.document.uri;
      capturedSelection = activeEditor.selection;
    }
  } else {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === targetUri.toString()) {
      capturedSelection = activeEditor.selection;
    }
  }

  return { targetUri, selection: capturedSelection };
}

async function buildPathContextTextForUri(targetUri: vscode.Uri, selection?: vscode.Selection): Promise<string | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('File is not in the workspace.');
    return undefined;
  }

  const relativePath = vscode.workspace.asRelativePath(targetUri, false);

  let isDirectory = false;
  try {
    const stat = await vscode.workspace.fs.stat(targetUri);
    isDirectory = stat.type === vscode.FileType.Directory;
    try { log.debug(`[CLI Hub] Path type detected: ${isDirectory ? 'directory' : 'file'} for ${relativePath}`); } catch { /* ignore */ }
  } catch (err) {
    try { log.debug(`[CLI Hub] fs.stat failed for ${relativePath}, assuming file. Error: ${err}`); } catch { /* ignore */ }
    isDirectory = false;
  }

  const text = buildPathContextText(relativePath, isDirectory, selection);
  if (selection && !selection.isEmpty && !isDirectory) {
    try { log.debug(`[CLI Hub] Built file path with line selection: ${text.trimEnd()}`); } catch { /* ignore */ }
  } else if (isDirectory) {
    try { log.debug(`[CLI Hub] Built directory path: ${text.trimEnd()}`); } catch { /* ignore */ }
  } else {
    try { log.debug(`[CLI Hub] Built file path: ${text.trimEnd()}`); } catch { /* ignore */ }
  }

  return text;
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function sendTextToIterm2CurrentSession(text: string): Promise<boolean> {
  if (process.platform !== 'darwin') {
    vscode.window.showErrorMessage('iTerm2 external sending is only supported on macOS.');
    return false;
  }

  try {
    await execFileAsync('osascript', buildIterm2WriteTextArgs(text));
    try { log.debug(`[CLI Hub] Sent to iTerm2 current session: ${text}`); } catch { /* ignore */ }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { log.warn(`[CLI Hub] Failed to send to iTerm2 current session: ${message}`); } catch { /* ignore */ }
    vscode.window.showErrorMessage(
      `Failed to send to iTerm2 current session. Check iTerm2 is running and macOS Automation permission is granted. ${message}`
    );
    return false;
  }
}

async function openLocalBridgeInstallEntry(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', LOCAL_BRIDGE_EXTENSION_ID);
    return;
  } catch (error) {
    try { log.warn(`[CLI Hub] Failed to start Local Bridge install directly: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
  }

  try {
    await vscode.commands.executeCommand('workbench.extensions.search', `@id:${LOCAL_BRIDGE_EXTENSION_ID}`);
  } catch (error) {
    try { log.warn(`[CLI Hub] Failed to open Local Bridge marketplace search: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
  }
}

async function promptForMissingLocalBridge(): Promise<'fallback' | 'install' | undefined> {
  const installAction = 'Install CLI Hub Local Bridge';
  const fallbackAction = 'Send to VS Code Terminal';
  const selection = await vscode.window.showWarningMessage(
    'Remote SSH needs CLI Hub Local Bridge installed locally to write to iTerm2.',
    installAction,
    fallbackAction
  );

  if (selection === installAction) {
    await openLocalBridgeInstallEntry();
    return 'install';
  }

  if (selection === fallbackAction) {
    return 'fallback';
  }

  return undefined;
}

async function promptForLocalBridgeFailure(message: string): Promise<'fallback' | undefined> {
  const fallbackAction = 'Send to VS Code Terminal';
  const selection = await vscode.window.showErrorMessage(
    `Failed to send to local iTerm2 through CLI Hub Local Bridge. ${message}`,
    fallbackAction
  );

  return selection === fallbackAction ? 'fallback' : undefined;
}

async function sendTextToLocalIterm2Bridge(text: string): Promise<'sent' | 'fallback' | 'cancelled'> {
  try {
    const result = await vscode.commands.executeCommand<boolean | void>(LOCAL_BRIDGE_WRITE_COMMAND, text);
    if (result === false) {
      const choice = await promptForLocalBridgeFailure('The bridge command returned false.');
      return choice === 'fallback' ? 'fallback' : 'cancelled';
    }
    try { log.debug(`[CLI Hub] Sent to local iTerm2 through bridge: ${text}`); } catch { /* ignore */ }
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { log.warn(`[CLI Hub] Local Bridge send failed: ${message}`); } catch { /* ignore */ }

    if (/command .*not found|not found/i.test(message)) {
      const choice = await promptForMissingLocalBridge();
      return choice === 'fallback' ? 'fallback' : 'cancelled';
    }

    const choice = await promptForLocalBridgeFailure(message);
    return choice === 'fallback' ? 'fallback' : 'cancelled';
  }
}

type PathTargetSendResult = 'sent' | 'fallback' | 'cancelled';

async function sendTextToConfiguredPathTarget(text: string): Promise<PathTargetSendResult> {
  const target = getPathSendTarget();
  if (target === 'iterm2') {
    if (shouldUseLocalIterm2Bridge(target, vscode.env.remoteName)) {
      return sendTextToLocalIterm2Bridge(text);
    }
    return (await sendTextToIterm2CurrentSession(text)) ? 'sent' : 'cancelled';
  }

  return 'fallback';
}

async function sendTextToVsCodeTerminalTarget(context: vscode.ExtensionContext, textToSend: string): Promise<boolean> {
  currentToolId = resolveToolId(context);
  updateStatusBar(currentToolId, context);

  let terminal = resolveTargetTerminalForSend(currentToolId);
  if (!terminal) {
    try { log.debug('[CLI Hub] sendPath: no terminal resolved, opening terminal with reuse-first routing'); } catch { /* ignore */ }
    terminal = await vscode.commands.executeCommand<vscode.Terminal | undefined>('clihub.openTerminalEditor');
    if (!terminal) {
      try { log.warn('[CLI Hub] Failed to resolve terminal after creating session'); } catch { /* ignore */ }
      return false;
    }
  }

  try { log.debug(`[CLI Hub] Sending to terminal: ${textToSend}`); } catch { /* ignore */ }
  const targetToolId = getTerminalToolId(terminal) ?? currentToolId;
  const payload = targetToolId === 'gemini' ? wrapWithBracketedPaste(textToSend) : textToSend;
  terminal.sendText(payload, false);
  terminal.show();
  touchSession(terminal);
  return true;
}


// 检测 CLI 命令是否已安装
async function checkCommandInstalled(context: vscode.ExtensionContext, toolIdOverride?: string, forceCheck = false): Promise<boolean> {
  if (codebuddyInstallationChecked && !forceCheck && !toolIdOverride) {
    return codebuddyInstalled;
  }

  const configuredToolId = toolIdOverride || getConfiguredDefaultToolId();
  const cmdToCheck = getToolById(configuredToolId)?.command || configuredToolId;
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? `where ${cmdToCheck}` : `which ${cmdToCheck}`;
    exec(command, (error) => {
      const isInstalled = !error;

      if (!toolIdOverride) {
        codebuddyInstallationChecked = true;
        codebuddyInstalled = isInstalled;
        context.globalState.update('codebuddyInstalled', isInstalled);
      }

      resolve(isInstalled);
    });
  });
}

export async function activate(context: vscode.ExtensionContext) {
  extensionContextRef = context;
  initLogger();
  try { log.info('[CLI Hub] Extension activated'); } catch { /* ignore */ }
  manifestTools = loadToolManifest(context.extensionPath, log);
  availableTools = [...manifestTools];
  try { log.info(`[CLI Hub] Loaded ${availableTools.length} tool profiles from manifest`); } catch { /* ignore */ }

  const cachedInstallationStatus = context.globalState.get<boolean>('codebuddyInstalled');
  if (cachedInstallationStatus !== undefined) {
    codebuddyInstallationChecked = true;
    codebuddyInstalled = cachedInstallationStatus;
  }

  await migrateLegacyToolSelection(context, log);
  currentToolId = resolveToolId(context);
  refreshSessionRegistryFromWindow();

  {
    const config = vscode.workspace.getConfiguration(CLIHUB_CONFIG_SECTION);
    const migrationKey = 'terminalModeMigratedToNative';
    const migrated = context.globalState.get<boolean>(migrationKey) === true;
    const inspect = config.inspect<string>('terminalOpenMode');
    const legacyValues = [inspect?.workspaceFolderValue, inspect?.workspaceValue, inspect?.globalValue];
    const hasEditorSetting = legacyValues.some(v => v === 'editor');
    if (hasEditorSetting && !migrated) {
      try {
        await config.update('terminalOpenMode', 'native', vscode.ConfigurationTarget.WorkspaceFolder);
      } catch { /* ignore */ }
      try {
        await config.update('terminalOpenMode', 'native', vscode.ConfigurationTarget.Workspace);
      } catch { /* ignore */ }
      try {
        await config.update('terminalOpenMode', 'native', vscode.ConfigurationTarget.Global);
      } catch { /* ignore */ }
      await context.globalState.update(migrationKey, true);
      vscode.window.showInformationMessage('CLI Hub 已移除 editor 模式，已自动切换为 native 终端模式。');
    }
  }

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'clihub.switchAITool';
  updateStatusBar(currentToolId, context);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const ensureToolInstalled = async (toolId: string): Promise<boolean> => {
    const actualName = getToolLabel(toolId);
    const isInstalled = await checkCommandInstalled(context, toolId, true);
    if (isInstalled) {
      return true;
    }

    const installAction = 'Install';
    const repairAction = 'Repair';
    const cancelAction = 'Cancel';
    const isCodebuddy = toolId === 'codebuddy';
    const isWindows = process.platform === 'win32';
    let message = `${actualName} is not installed. Would you like to install it?`;
    let actions: string[] = [installAction, cancelAction];

    if (isCodebuddy) {
      if (isWindows) {
        message = `${actualName} is not installed. Repair is not supported on Windows. Would you like to install it?`;
      } else {
        actions = [installAction, repairAction, cancelAction];
      }
    }

    const selection = await vscode.window.showWarningMessage(message, ...actions);
    if (selection === installAction) {
      const installTerminal = vscode.window.createTerminal(`Install ${actualName}`);
      installTerminal.show();
      installTerminal.sendText(getInstallCommand(toolId), true);
      vscode.window.showInformationMessage(
        `Installing ${actualName}... Please click the terminal button again after installation completes.`,
        'Refresh Detection'
      ).then(choice => {
        if (choice === 'Refresh Detection') {
          vscode.commands.executeCommand('clihub.refreshDetection');
        }
      });
    }

    if (selection === repairAction) {
      try {
        const scriptPath = path.join(context.extensionPath, 'scripts', 'fix-codebuddy.sh');
        const repairTerminal = vscode.window.createTerminal('Repair Codebuddy');
        repairTerminal.show();
        repairTerminal.sendText(`bash "${scriptPath}"`, true);
        try { log.info(`[CLI Hub] Launched Codebuddy repair script: ${scriptPath}`); } catch { /* ignore */ }
      } catch (error) {
        try { log.error(`[CLI Hub] Failed to launch Codebuddy repair script: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
      }
    }
    return false;
  };

  const openTerminalForCurrentTool = async (forceNewSession: boolean): Promise<vscode.Terminal | undefined> => {
    if (isOpeningTerminal) {
      return undefined;
    }
    isOpeningTerminal = true;

    let pythonToggleToken = pythonActivationToggleToken;
    let pythonSettingChanged = false;
    let pythonRestoreScheduled = false;

    try {
      currentToolId = resolveToolId(context);
      updateStatusBar(currentToolId, context);

      const isInstalled = await ensureToolInstalled(currentToolId);
      if (!isInstalled) {
        return undefined;
      }

      try {
        const result = await disablePythonTerminalAutoActivation();
        pythonToggleToken = result.token;
        pythonSettingChanged = result.changed;
      } catch { /* ignore */ }

      const workspacePath = getCurrentWorkspacePath();
      const resolved = resolveTerminalForOpen(currentToolId, forceNewSession, workspacePath);
      const terminal = resolved.terminal;

      terminal.show();
      await applyNativeTerminalLocationPreference();

      if (resolved.created) {
        const startCommand = getStartCommandForTool(currentToolId, true);
        terminal.sendText(startCommand, true);
      }

      if (pythonSettingChanged) {
        schedulePythonTerminalActivationRestore(pythonToggleToken, pythonSettingChanged);
        pythonRestoreScheduled = true;
      }

      touchSession(terminal);
      lastActiveCliHubTerminal = terminal;
      return terminal;
    } finally {
      isOpeningTerminal = false;
      if (pythonSettingChanged && !pythonRestoreScheduled) {
        schedulePythonTerminalActivationRestore(pythonToggleToken, pythonSettingChanged);
      }
    }
  };

  const switchAIToolHandler = async () => {
    const previousTool = currentToolId;
    const selected = await selectAITool(context);
    if (!selected || selected === previousTool) {
      return;
    }

    currentToolId = selected;
    const workspacePath = getCurrentWorkspacePath();
    const activeCliHubTerminal = getActiveCliHubTerminalAnyTool();
    if (activeCliHubTerminal) {
      if (terminalMatchesPreparedToolContext(activeCliHubTerminal, selected, workspacePath)) {
        const switched = await switchCliInTerminal(activeCliHubTerminal, selected);
        if (switched) {
          return;
        }
      } else {
        try {
          log.info(`[CLI Hub] Active terminal missing required environment for ${selected}; opening a prepared session instead.`);
        } catch { /* ignore */ }
      }
    }

    try {
      await openTerminalForCurrentTool(false);
    } catch (error) {
      try { log.error(`[CLI Hub] Failed to open terminal after switching tool: ${error instanceof Error ? error.message : String(error)}`); } catch { /* ignore */ }
    }
  };

  const switchAIToolDisposable = vscode.commands.registerCommand('clihub.switchAITool', switchAIToolHandler);

  const setGlobalDefaultToolHandler = async () => {
    const currentDefault = context.globalState.get<string>(GLOBAL_DEFAULT_TOOL_KEY);
    const items = getAvailableTools().map(tool => ({
      label: tool.label,
      description: tool.description,
      detail: tool.id === currentDefault ? '$(star) Current default' : undefined,
      toolId: tool.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select default AI tool for all workspaces',
      title: 'Set Global Default Tool',
    });

    if (!selected) {
      return;
    }

    await context.globalState.update(GLOBAL_DEFAULT_TOOL_KEY, selected.toolId);
    vscode.window.showInformationMessage(`${selected.label} is now the default tool for new workspaces.`);
    try { log.info(`[CLI Hub] Global default tool set to: ${selected.toolId}`); } catch { /* ignore */ }

    if (hasWorkspaceOverride(context)) {
      return;
    }

    const previousTool = currentToolId;
    const nextTool = resolveToolId(context);
    if (previousTool === nextTool) {
      updateStatusBar(currentToolId, context);
      return;
    }

    currentToolId = nextTool;
    updateStatusBar(currentToolId, context);
    await openTerminalForCurrentTool(false);
  };

  const setGlobalDefaultToolDisposable = vscode.commands.registerCommand('clihub.setGlobalDefaultTool', setGlobalDefaultToolHandler);

  const openTerminalEditorDisposable = vscode.commands.registerCommand('clihub.openTerminalEditor', async () => {
    return openTerminalForCurrentTool(false);
  });

  const openNewTerminalSessionDisposable = vscode.commands.registerCommand('clihub.openNewTerminalSession', async () => {
    return openTerminalForCurrentTool(true);
  });

  // 智能快捷键：打开终端或发送文件路径
  const sendPathDisposable = vscode.commands.registerCommand('clihub.sendPathToTerminal', async (uri?: vscode.Uri, _uris?: vscode.Uri[]) => {
    try { log.debug('[CLI Hub] sendPathToTerminal: triggered'); } catch { /* ignore */ }

    const { targetUri, selection } = resolvePathTarget(uri);

    // 如果没有选中文件，直接打开或显示 terminal
    if (!targetUri) {
      try { log.debug('[CLI Hub] No file selected, opening/showing terminal'); } catch { /* ignore */ }
      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      return;
    }

    const textToSend = await buildPathContextTextForUri(targetUri, selection);
    if (!textToSend) {
      return;
    }

    if (getPathSendTarget() !== 'vscodeTerminal') {
      const result = await sendTextToConfiguredPathTarget(textToSend);
      if (result === 'fallback') {
        await sendTextToVsCodeTerminalTarget(context, textToSend);
      }
      return;
    }

    await sendTextToVsCodeTerminalTarget(context, textToSend);
  });

  const copyPathDisposable = vscode.commands.registerCommand('clihub.copyPathToClipboard', async (uri?: vscode.Uri, _uris?: vscode.Uri[]) => {
    try { log.debug('[CLI Hub] copyPathToClipboard: triggered'); } catch { /* ignore */ }

    const { targetUri, selection } = resolvePathTarget(uri);
    if (!targetUri) {
      vscode.window.showWarningMessage('Select a file or directory to copy its path context.');
      return;
    }

    const textToCopy = await buildPathContextTextForUri(targetUri, selection);
    if (!textToCopy) {
      return;
    }

    await vscode.env.clipboard.writeText(textToCopy);
    vscode.window.showInformationMessage(`Copied: ${textToCopy.trimEnd()}`);
    try { log.debug(`[CLI Hub] Copied to clipboard: ${textToCopy}`); } catch { /* ignore */ }
  });

  // 重新检测 CLI 命令安装状态的命令
  const refreshDetectionDisposable = vscode.commands.registerCommand('clihub.refreshDetection', async () => {
    const activeToolId = resolveToolId(context);
    const activeLabel = getToolLabel(activeToolId);
    const isInstalled = await checkCommandInstalled(context, activeToolId, true);
    if (isInstalled) {
      vscode.window.showInformationMessage(`${activeLabel} is now installed and ready to use!`);
    } else {
      vscode.window.showWarningMessage(`${activeLabel} is still not detected. Please ensure it is properly installed.`);
    }
  });

  // 显示日志窗口的命令（便于快速打开日志）
  const showLogsDisposable = vscode.commands.registerCommand('clihub.showLogs', () => {
    initLogger();
    try { log.show(); } catch { /* ignore */ }
  });

  const openSubscription = vscode.window.onDidOpenTerminal((terminal) => {
    try { log.info(`[CLI Hub] Terminal opened: name=${terminal.name}`); } catch { /* ignore */ }
    if (isCodebuddyTerminal(terminal)) {
      const toolId = getTerminalToolId(terminal) ?? currentToolId;
      registerSession(terminal, toolId);
    }
  });

  const activeTerminalSubscription = vscode.window.onDidChangeActiveTerminal((terminal) => {
    if (!terminal || !isCodebuddyTerminal(terminal)) {
      return;
    }
    touchSession(terminal);
    lastActiveCliHubTerminal = terminal;
  });

  const closeSubscription = vscode.window.onDidCloseTerminal(async (terminal) => {
    removeSession(terminal);
    try {
      const code = terminal.exitStatus?.code;
      log.info(`[CLI Hub] Terminal closed: name=${terminal.name} exitCode=${code ?? 'undefined'}`);
    } catch { /* ignore */ }
  });

  context.subscriptions.push(
    openTerminalEditorDisposable,
    openNewTerminalSessionDisposable,
    sendPathDisposable,
    copyPathDisposable,
    refreshDetectionDisposable,
    showLogsDisposable,
    switchAIToolDisposable,
    setGlobalDefaultToolDisposable,
    openSubscription,
    activeTerminalSubscription,
    closeSubscription
  );
}

export async function deactivate() {
  codebuddyTerminal = undefined;
  sessionRegistry.clear();
  lastActiveCliHubTerminal = undefined;
  try { await restorePythonTerminalActivationImmediately(); } catch { /* ignore */ }
}

export async function __resetToolSelectionForTests(): Promise<void> {
  const context = extensionContextRef;
  if (!context) {
    return;
  }
  try {
    await context.workspaceState.update(WORKSPACE_TOOL_KEY, undefined);
  } catch { /* ignore */ }
}

export function __setCurrentToolIdForTests(toolId: string): void {
  currentToolId = toolId;
}

export function __registerToolForTests(tool: ToolManifestEntry): void {
  const existing = getToolById(tool.id);
  if (existing) {
    availableTools = availableTools.map(entry => entry.id === tool.id ? { ...existing, ...tool } : entry);
    return;
  }
  availableTools = [...availableTools, { ...tool }];
}

export function __resetAvailableToolsForTests(): void {
  availableTools = [...manifestTools];
}
