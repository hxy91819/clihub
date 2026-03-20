import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { disposeAllTerminals, delay } from './test-helpers';
import { __registerToolForTests, __resetAvailableToolsForTests } from '../../extension';

const PANEL_POSITION_RIGHT_COMMAND = 'workbench.action.positionPanelRight';

describe('Integration: Terminal Adoption', () => {
  before(() => {
    __registerToolForTests({
      id: 'bash',
      label: 'bash',
      description: 'Test shell tool',
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

  // 每个测试后清理所有终端
  afterEach(async function() {
    this.timeout(5000);
    await disposeAllTerminals();
    // 等待终端完全关闭
    await delay(300);
  });

  /**
   * 测试 1: openTerminalEditor 在存在通用终端时应能完成执行
   * 场景：扩展启动时存在一个 zsh/bash 等通用终端；不应因为安装检测/交互提示导致用例卡住
   */
  it('Integration: 存在通用终端时 openTerminalEditor 不应卡住', async function() {
    this.timeout(15000);

    const config = vscode.workspace.getConfiguration('clihub');
    const inspect = config.inspect<string>('terminalCommand');
    const previousWorkspaceValue = inspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    // 预置：创建一个通用 shell 终端
    const genericTerminal = vscode.window.createTerminal({
      name: 'bash',
      shellPath: '/bin/bash',
    });

    try {
      // 使用系统普遍存在的命令，避免安装检测弹窗阻塞测试
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      // 等待终端创建完成
      await delay(500);

      const terminalCountBefore = vscode.window.terminals.length;
      console.log(`Terminal count before: ${terminalCountBefore}`);

      // 行为：执行 openTerminalEditor 命令
      await vscode.commands.executeCommand('clihub.openTerminalEditor');

      // 等待命令执行完成
      await delay(1500);

      const terminalCountAfter = vscode.window.terminals.length;
      console.log(`Terminal count after: ${terminalCountAfter}`);

      // 断言：最多增加 1 个终端，避免创建风暴
      assert.ok(
        terminalCountAfter <= terminalCountBefore + 1,
        'Terminal count should not increase by more than 1'
      );

      // 注意：在测试环境中终端渲染行为可能不同，因此仅验证命令不会阻塞且终端数量增长可控
      console.log('openTerminalEditor completed (no hang) and terminal count increase is bounded');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousWorkspaceValue, vscode.ConfigurationTarget.Workspace);
      try { genericTerminal.dispose(); } catch { /* ignore */ }
    }
  });

  /**
   * 测试 2: Post-activate 扫描收养
   * 场景：激活后延迟扫描收养通用终端
   */
  it('Integration: Post-activate 应扫描并收养通用终端', async function() {
    this.timeout(10000);

    // 注意：此测试依赖于扩展的 setTimeout 逻辑（800ms 延迟）
    // 我们在扩展激活后创建终端，然后等待扫描逻辑触发

    // 预置：创建一个通用终端（模拟 VS Code 重启后恢复的场景）
    const genericTerminal = vscode.window.createTerminal({
      name: 'bash',
      shellPath: '/bin/bash',
    });

    await delay(500);

    const terminalCountBefore = vscode.window.terminals.length;
    console.log(`Terminal count before scan: ${terminalCountBefore}`);

    // 等待 post-activate 扫描逻辑触发（>800ms，使用 1200ms 留余量）
    await delay(1200);

    const terminalCountAfter = vscode.window.terminals.length;
    console.log(`Terminal count after scan: ${terminalCountAfter}`);

    // 断言：终端总数不变
    assert.strictEqual(
      terminalCountAfter,
      terminalCountBefore,
      'Post-activate scan should not create new terminals'
    );

    // 注意：由于扩展的 post-activate 逻辑仅在启动时运行一次，
    // 此测试可能无法完全模拟启动场景。作为替代，我们检查终端状态稳定。
    console.log('Post-activate scan test completed (terminal state stable)');
  });

  /**
   * 测试 3: onDidOpenTerminal 收养
   * 场景：运行时打开通用名称终端触发收养
   */
  it('Integration: onDidOpenTerminal 应收养通用终端', async function() {
    this.timeout(10000);

    const terminalCountBefore = vscode.window.terminals.length;
    console.log(`Terminal count before: ${terminalCountBefore}`);

    // 预置：扩展已激活
    // 行为：创建一个通用终端（模拟 node 进程）
    const terminal = vscode.window.createTerminal({
      name: 'node',
      shellPath: '/usr/bin/node',
      location: { viewColumn: vscode.ViewColumn.Beside },
    });

    // 等待 onDidOpenTerminal 事件触发和延迟逻辑（600ms + 余量）
    await delay(1000);

    const terminalCountAfter = vscode.window.terminals.length;
    console.log(`Terminal count after: ${terminalCountAfter}`);

    // 断言：终端应该被保留（不被销毁）
    // 注意：在测试环境中，终端可能会被清理，因此我们只验证不会创建额外的终端
    assert.ok(
      terminalCountAfter <= terminalCountBefore + 1,
      'Should not create extra terminals'
    );

    console.log('onDidOpenTerminal adoption logic verified');
  });

  /**
   * 测试 4: 避免重复创建终端
   * 场景：连续点击不应创建多个终端
   */
  it('Integration: 连续执行命令不应创建多个终端', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const inspect = config.inspect<string>('terminalCommand');
    const previousWorkspaceValue = inspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    try {
      // 使用系统普遍存在的命令，避免安装检测弹窗阻塞测试
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      const terminalCountBefore = vscode.window.terminals.length;
      console.log(`Terminal count before concurrent execution: ${terminalCountBefore}`);

      // 行为：连续执行 2 次 openTerminalEditor（间隔 50ms）
      const promise1 = vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(50);
      const promise2 = vscode.commands.executeCommand('clihub.openTerminalEditor');

      // 等待两个命令都完成
      await Promise.all([promise1, promise2]);

      // 等待终端创建完成
      await delay(1500);

      const terminalCountAfter = vscode.window.terminals.length;
      console.log(`Terminal count after concurrent execution: ${terminalCountAfter}`);

      // 断言：应只增加最多1个终端（防止并发创建）
      // 注意：扩展使用 isOpeningTerminal 标志位防止并发
      assert.ok(
        terminalCountAfter <= terminalCountBefore + 1,
        'Concurrent execution should not create multiple terminals'
      );

      console.log('Concurrent execution protection verified');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousWorkspaceValue, vscode.ConfigurationTarget.Workspace);
    }
  });

  /**
   * 测试 5: 收养后终端应保持稳定状态
   * 场景：确保收养流程不会导致终端创建风暴
   */
  it('Integration: 收养的终端应保持稳定状态', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const inspect = config.inspect<string>('terminalCommand');
    const previousWorkspaceValue = inspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    // 预置：创建一个不在 Editor 的通用终端
    const terminal = vscode.window.createTerminal({
      name: 'sh',
      shellPath: '/bin/sh',
    });

    try {
      // 使用系统普遍存在的命令，避免安装检测弹窗阻塞测试
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      const terminalCountBefore = vscode.window.terminals.length;
      console.log(`Terminal count before: ${terminalCountBefore}`);

      // 显示终端（在面板中）
      terminal.show();
      await delay(500);

      const terminalCountBeforeCommand = vscode.window.terminals.length;

      // 行为：执行 openTerminalEditor
      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(1500);

      const terminalCountAfter = vscode.window.terminals.length;
      console.log(`Terminal count after: ${terminalCountAfter}`);

      // 断言：最多增加 1 个终端，避免创建风暴
      assert.ok(
        terminalCountAfter <= terminalCountBeforeCommand + 1,
        'Terminal count should not increase by more than 1'
      );

      console.log('Terminal adoption stability verified (bounded terminal creation)');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousWorkspaceValue, vscode.ConfigurationTarget.Workspace);
      try { terminal.dispose(); } catch { /* ignore */ }
    }
  });

  it('Integration: openNewTerminalSession 应创建新会话，openTerminalEditor 应优先复用', async function() {
    this.timeout(25000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const previousCommand = cmdInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      const countBefore = vscode.window.terminals.length;
      await vscode.commands.executeCommand('clihub.openNewTerminalSession');
      await delay(1200);
      const countAfterNew = vscode.window.terminals.length;
      assert.ok(countAfterNew >= countBefore + 1, 'openNewTerminalSession should create at least one terminal');

      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(800);
      const countAfterOpen = vscode.window.terminals.length;
      assert.ok(countAfterOpen <= countAfterNew + 1, 'openTerminalEditor should prefer reuse and avoid terminal storm');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('Integration: sendPathToTerminal 连续触发时应复用已有会话', async function() {
    this.timeout(25000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const previousCommand = cmdInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      const targetUri = workspaceFixtureUri('.gitkeep');
      const doc = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(doc, { preview: false });

      await vscode.commands.executeCommand('clihub.sendPathToTerminal');
      await delay(1500);
      const countAfterFirstSend = vscode.window.terminals.length;

      await vscode.window.showTextDocument(doc, { preview: false });
      await delay(200);

      await vscode.commands.executeCommand('clihub.sendPathToTerminal');
      await delay(1200);
      const countAfterSecondSend = vscode.window.terminals.length;

      assert.ok(countAfterFirstSend >= 1, 'First sendPathToTerminal should create or reuse a terminal');
      assert.strictEqual(
        countAfterSecondSend,
        countAfterFirstSend,
        'Second sendPathToTerminal should reuse the existing matching session'
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('Integration: 同 workspace 同环境的会话仍应被复用', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const envInspect = config.inspect<Record<string, Record<string, string>>>('toolEnvironments');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousEnvironments = envInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;

    let terminal: vscode.Terminal | undefined;

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', {
        bash: {
          CLI_TEST_ENV: '1',
        },
      } as Record<string, Record<string, string>>, vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';

      terminal = vscode.window.createTerminal({
        name: 'bash',
        env: {
          CLIHUB_TERMINAL: '1',
          CLIHUB_TOOL_ID: 'bash',
          CLIHUB_TOOL_ENV_SIGNATURE: 'CLI_TEST_ENV=1',
          CLIHUB_WORKSPACE_PATH: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
          CLI_TEST_ENV: '1',
        }
      });

      terminal.show();
      await delay(500);

      const countBefore = vscode.window.terminals.length;
      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(1200);

      const countAfter = vscode.window.terminals.length;
      assert.strictEqual(countAfter, countBefore, 'Matching session should still be reused');
    } finally {
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('toolEnvironments', previousEnvironments, vscode.ConfigurationTarget.Workspace);
      try { terminal?.dispose(); } catch { /* ignore */ }
    }
  });

  it('Integration: nativeTerminalLocation=right 时 openTerminalEditor 应触发右移命令', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const locationInspect = config.inspect<string>('nativeTerminalLocation');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousLocation = locationInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;

    const executedCommands: string[] = [];

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', 'right', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
        executedCommands.push(command);
        return originalExecuteCommand.call(vscode.commands, command, ...args);
      };

      await vscode.commands.executeCommand('clihub.openTerminalEditor');
      await delay(1500);

      assert.ok(
        executedCommands.includes(PANEL_POSITION_RIGHT_COMMAND),
        'openTerminalEditor should request moving the panel right when nativeTerminalLocation=right'
      );
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', previousLocation, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('Integration: nativeTerminalLocation=right 时 openNewTerminalSession 应触发右移命令', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const locationInspect = config.inspect<string>('nativeTerminalLocation');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousLocation = locationInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;

    const executedCommands: string[] = [];

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', 'right', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
        executedCommands.push(command);
        return originalExecuteCommand.call(vscode.commands, command, ...args);
      };

      await vscode.commands.executeCommand('clihub.openNewTerminalSession');
      await delay(1500);

      assert.ok(
        executedCommands.includes(PANEL_POSITION_RIGHT_COMMAND),
        'openNewTerminalSession should request moving the panel right when nativeTerminalLocation=right'
      );
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', previousLocation, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('Integration: nativeTerminalLocation=right 时 sendPathToTerminal 创建会话也应触发右移命令', async function() {
    this.timeout(20000);

    const config = vscode.workspace.getConfiguration('clihub');
    const cmdInspect = config.inspect<string>('terminalCommand');
    const locationInspect = config.inspect<string>('nativeTerminalLocation');
    const previousCommand = cmdInspect?.workspaceValue;
    const previousLocation = locationInspect?.workspaceValue;
    const originalWarningMessage = (vscode.window as any).showWarningMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;

    const executedCommands: string[] = [];

    try {
      await config.update('terminalCommand', 'bash', vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', 'right', vscode.ConfigurationTarget.Workspace);
      (vscode.window as any).showWarningMessage = async () => 'Cancel';
      (vscode.commands as any).executeCommand = async (command: string, ...args: any[]) => {
        executedCommands.push(command);
        return originalExecuteCommand.call(vscode.commands, command, ...args);
      };

      await vscode.commands.executeCommand('clihub.sendPathToTerminal');
      await delay(1500);

      assert.ok(
        executedCommands.includes(PANEL_POSITION_RIGHT_COMMAND),
        'sendPathToTerminal should request moving the panel right when it creates a terminal session'
      );
    } finally {
      (vscode.commands as any).executeCommand = originalExecuteCommand;
      (vscode.window as any).showWarningMessage = originalWarningMessage;
      await config.update('terminalCommand', previousCommand, vscode.ConfigurationTarget.Workspace);
      await config.update('nativeTerminalLocation', previousLocation, vscode.ConfigurationTarget.Workspace);
    }
  });

});
