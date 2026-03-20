import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { delay, disposeAllTerminals, waitForCondition } from './test-helpers';
import { __registerToolForTests, __resetAvailableToolsForTests, __resetToolSelectionForTests, __setCurrentToolIdForTests } from '../../extension';

function collectTabUris(): Set<string> {
  const set = new Set<string>();
  try {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input as any;
        const uri: vscode.Uri | undefined = input?.uri;
        if (uri) {
          set.add(uri.toString());
        }
      }
    }
  } catch { /* ignore */ }
  return set;
}

describe('Integration: Switch AI Tool', () => {
  before(() => {
    __registerToolForTests({
      id: 'gemini',
      label: 'Gemini CLI',
      description: 'Google Gemini CLI',
      command: 'bash',
    });
    __registerToolForTests({
      id: 'claude',
      label: 'Claude Code',
      description: 'Anthropic Claude Code',
      command: 'bash',
    });
    __registerToolForTests({
      id: 'codex',
      label: 'Codex',
      description: 'OpenAI Codex',
      command: 'bash',
    });
  });

  after(() => {
    __resetAvailableToolsForTests();
  });

  function workspaceFixtureUri(fileName: string): vscode.Uri {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspacePath, 'Workspace path should be available for integration tests');
    return vscode.Uri.file(path.join(workspacePath, fileName));
  }

  afterEach(async function() {
    this.timeout(8000);
    try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    await disposeAllTerminals();
    await delay(300);
  });

  it('Integration: 切换工具不应关闭已打开的编辑器 Tab', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const inspect = config.inspect<string>('terminalCommand');
    const previousWorkspaceValue = inspect?.workspaceValue;

    const originalQuickPick = (vscode.window as any).showQuickPick;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalInfoMessage = (vscode.window as any).showInformationMessage;

    try {
      await config.update('terminalCommand', 'node', vscode.ConfigurationTarget.Workspace);

      const doc1 = await vscode.workspace.openTextDocument({ content: 'doc-1' });
      const doc2 = await vscode.workspace.openTextDocument({ content: 'doc-2' });

      await vscode.window.showTextDocument(doc1, { preview: false, viewColumn: vscode.ViewColumn.One });
      await vscode.window.showTextDocument(doc2, { preview: false, viewColumn: vscode.ViewColumn.Two });

      const expectedUris = [doc1.uri.toString(), doc2.uri.toString()];
      const tabsReady = await waitForCondition(() => {
        const uris = collectTabUris();
        return expectedUris.every(u => uris.has(u));
      }, 5000, 100);
      assert.ok(tabsReady, 'Precondition failed: expected docs not present in editor tabs');

      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(1200);

      (vscode.window as any).showQuickPick = async (items: any[]) => {
        return items.find(item => item.toolId === 'gemini') ?? items[0];
      };
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.window as any).showInformationMessage = async () => undefined;

      await vscode.commands.executeCommand('clihub.switchAITool');
      await delay(1500);

      const urisAfter = collectTabUris();
      for (const uri of expectedUris) {
        assert.ok(urisAfter.has(uri), `Editor tab should remain open after switch: ${uri}`);
      }
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      (vscode.window as any).showInformationMessage = originalInfoMessage;

      await config.update('terminalCommand', previousWorkspaceValue, vscode.ConfigurationTarget.Workspace);
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });

  it('Integration: 激活 CLI Hub 会话切换工具时应发送双中断并启动新命令', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const argsInspect = config.inspect<Record<string, string>>('toolArguments');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousArgs = argsInspect?.workspaceValue;

    const originalQuickPick = (vscode.window as any).showQuickPick;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalInfoMessage = (vscode.window as any).showInformationMessage;

    const sentCommands: Array<{ text: string; addNewLine?: boolean }> = [];
    let terminal: vscode.Terminal | undefined;

    try {
      await config.update('terminalCommand', 'gemini', vscode.ConfigurationTarget.Workspace);
      await config.update('toolArguments', {
        'codex': '--dangerously-bypass-approvals-and-sandbox'
      }, vscode.ConfigurationTarget.Workspace);

      terminal = vscode.window.createTerminal({
        name: 'Gemini CLI',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'gemini',
        }
      });

      const originalSendText = terminal.sendText.bind(terminal);
      (terminal as any).sendText = (text: string, addNewLine?: boolean) => {
        sentCommands.push({ text, addNewLine });
        // 保留原行为，避免脱离真实终端路径
        originalSendText(text, addNewLine);
      };

      terminal.show();
      await delay(500);

      (vscode.window as any).showQuickPick = async (items: any[]) => {
        return items.find(item => item.toolId === 'codex') ?? items[0];
      };
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.window as any).showInformationMessage = async () => undefined;

      await vscode.commands.executeCommand('clihub.switchAITool');
      await delay(900);

      const interrupts = sentCommands.filter(c => c.text === '\u0003');
      assert.ok(interrupts.length >= 2, 'Switching should send double Ctrl+C to leave current interactive CLI');

      const expectedCommand = 'bash --dangerously-bypass-approvals-and-sandbox';
      const startCommand = sentCommands.find(c => c.text.trim() === expectedCommand);
      assert.ok(startCommand, `Switching should send start command: ${expectedCommand}`);
      assert.strictEqual(startCommand?.addNewLine, true, 'Start command should be executed with newline');
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      (vscode.window as any).showInformationMessage = originalInfoMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('toolArguments', previousArgs, vscode.ConfigurationTarget.Workspace);
      try { terminal?.dispose(); } catch { /* ignore */ }
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });

  it('Integration: 切换到需要环境变量的工具时应打开带环境变量的新会话', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const envInspect = config.inspect<Record<string, Record<string, string>>>('toolEnvironments');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousEnvironments = envInspect?.workspaceValue;

    const originalQuickPick = (vscode.window as any).showQuickPick;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalInfoMessage = (vscode.window as any).showInformationMessage;

    const sentCommands: Array<{ text: string; addNewLine?: boolean }> = [];
    let terminal: vscode.Terminal | undefined;

    try {
      await config.update('terminalCommand', 'gemini', vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', {
        'claude': {
          IS_SANDBOX: '1',
        },
      }, vscode.ConfigurationTarget.Workspace);

      terminal = vscode.window.createTerminal({
        name: 'Gemini CLI',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'gemini',
        }
      });

      const originalSendText = terminal.sendText.bind(terminal);
      (terminal as any).sendText = (text: string, addNewLine?: boolean) => {
        sentCommands.push({ text, addNewLine });
        originalSendText(text, addNewLine);
      };

      terminal.show();
      await delay(500);

      (vscode.window as any).showQuickPick = async (items: any[]) => {
        return items.find(item => item.toolId === 'claude') ?? items[0];
      };
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.window as any).showInformationMessage = async () => undefined;

      await vscode.commands.executeCommand('clihub.switchAITool');
      await delay(1200);

      const interrupted = sentCommands.some(c => c.text === '\u0003');
      assert.strictEqual(interrupted, false, 'Should not switch in place when required env vars are missing');

      const matching = vscode.window.terminals.find(t => {
        try {
          const options = (t.creationOptions ?? {}) as vscode.TerminalOptions;
          const env = (options.env ?? {}) as Record<string, string | undefined>;
          return env.CLIHUB_TERMINAL === '1'
            && env.CLIHUB_TOOL_ID === 'claude'
            && env.IS_SANDBOX === '1';
        } catch {
          return false;
        }
      });

      assert.ok(matching, 'Should create or reuse a claude terminal with IS_SANDBOX=1');
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      (vscode.window as any).showInformationMessage = originalInfoMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', previousEnvironments, vscode.ConfigurationTarget.Workspace);
      try { terminal?.dispose(); } catch { /* ignore */ }
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });

  it('Integration: 打开终端时不应复用缺少所需环境变量的旧会话', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const envInspect = config.inspect<Record<string, Record<string, string>>>('toolEnvironments');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousEnvironments = envInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    let staleTerminal: vscode.Terminal | undefined;

    try {
      await config.update('terminalCommand', 'claude', vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', {
        'claude': {
          IS_SANDBOX: '1',
        },
      }, vscode.ConfigurationTarget.Workspace);

      staleTerminal = vscode.window.createTerminal({
        name: 'Claude Code',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'claude',
          CLIHUB_TOOL_ENV_SIGNATURE: '',
          CLIHUB_WORKSPACE_PATH: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        }
      });

      staleTerminal.show();
      await delay(500);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      const countBefore = vscode.window.terminals.length;
      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(1200);

      const countAfter = vscode.window.terminals.length;
      assert.ok(countAfter >= countBefore + 1, 'Should create a new prepared terminal instead of reusing stale session');

      const matching = vscode.window.terminals.find(t => {
        try {
          const options = (t.creationOptions ?? {}) as vscode.TerminalOptions;
          const env = (options.env ?? {}) as Record<string, string | undefined>;
          return t !== staleTerminal
            && env.CLIHUB_TERMINAL === '1'
            && env.CLIHUB_TOOL_ID === 'claude'
            && env.IS_SANDBOX === '1';
        } catch {
          return false;
        }
      });

      assert.ok(matching, 'Should open a claude terminal with the required environment variables');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', previousEnvironments, vscode.ConfigurationTarget.Workspace);
      try { staleTerminal?.dispose(); } catch { /* ignore */ }
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });

  it('Integration: 从带专有环境的会话切换到普通工具时不应原地复用', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const envInspect = config.inspect<Record<string, Record<string, string>>>('toolEnvironments');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousEnvironments = envInspect?.workspaceValue;

    const originalQuickPick = (vscode.window as any).showQuickPick;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalInfoMessage = (vscode.window as any).showInformationMessage;

    const sentCommands: Array<{ text: string; addNewLine?: boolean }> = [];
    let terminal: vscode.Terminal | undefined;

    try {
      await config.update('terminalCommand', 'claude', vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', {
        'claude': {
          IS_SANDBOX: '1',
        },
      }, vscode.ConfigurationTarget.Workspace);

      terminal = vscode.window.createTerminal({
        name: 'Claude Code',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'claude',
          CLIHUB_TOOL_ENV_SIGNATURE: 'IS_SANDBOX=1',
          CLIHUB_WORKSPACE_PATH: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
          IS_SANDBOX: '1',
        }
      });

      const originalSendText = terminal.sendText.bind(terminal);
      (terminal as any).sendText = (text: string, addNewLine?: boolean) => {
        sentCommands.push({ text, addNewLine });
        originalSendText(text, addNewLine);
      };

      terminal.show();
      await delay(500);

      (vscode.window as any).showQuickPick = async (items: any[]) => {
        return items.find(item => item.toolId === 'gemini') ?? items[0];
      };
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.window as any).showInformationMessage = async () => undefined;

      await vscode.commands.executeCommand('clihub.switchAITool');
      await delay(1200);

      const interrupted = sentCommands.some(c => c.text === '\u0003');
      assert.strictEqual(interrupted, false, 'Should not switch in place from an env-prepared terminal to a plain tool');

      const matching = vscode.window.terminals.find(t => {
        try {
          const options = (t.creationOptions ?? {}) as vscode.TerminalOptions;
          const env = (options.env ?? {}) as Record<string, string | undefined>;
          return t !== terminal
            && env.CLIHUB_TERMINAL === '1'
            && env.CLIHUB_TOOL_ID === 'gemini'
            && (env.CLIHUB_TOOL_ENV_SIGNATURE ?? '') === ''
            && env.IS_SANDBOX === undefined;
        } catch {
          return false;
        }
      });

      assert.ok(matching, 'Should open a fresh gemini terminal without leaked claude-specific environment');
    } finally {
      (vscode.window as any).showQuickPick = originalQuickPick;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      (vscode.window as any).showInformationMessage = originalInfoMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', previousEnvironments, vscode.ConfigurationTarget.Workspace);
      try { terminal?.dispose(); } catch { /* ignore */ }
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });

  it('Integration: sendPathToTerminal 应实时跟随 terminalCommand 配置变化', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const previousCommand = cmdInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    const sentCommands: Array<{ text: string; addNewLine?: boolean }> = [];
    let terminal: vscode.Terminal | undefined;

    try {
      __setCurrentToolIdForTests('claude');
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      await __resetToolSelectionForTests();

      await config.update('terminalCommand', 'gemini', vscode.ConfigurationTarget.Workspace);
      terminal = vscode.window.createTerminal({
        name: 'Gemini CLI',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'gemini',
          CLIHUB_TOOL_ENV_SIGNATURE: '',
          CLIHUB_WORKSPACE_PATH: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        }
      });

      const originalSendText = terminal.sendText.bind(terminal);
      (terminal as any).sendText = (text: string, addNewLine?: boolean) => {
        sentCommands.push({ text, addNewLine });
        originalSendText(text, addNewLine);
      };

      const targetUri = workspaceFixtureUri('.gitkeep');
      const doc = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      terminal.show();
      await delay(500);

      await vscode.commands.executeCommand('clihub.sendPathToTerminal');
      await delay(600);

      const payload = sentCommands.find(c => c.text.includes('@.gitkeep '));
      assert.ok(payload, 'sendPathToTerminal should route to the terminal that matches the latest terminalCommand');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      __setCurrentToolIdForTests(previousCommand ?? 'codebuddy');
      try { terminal?.dispose(); } catch { /* ignore */ }
      try { await __resetToolSelectionForTests(); } catch { /* ignore */ }
    }
  });
});
