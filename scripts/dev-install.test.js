'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  BRIDGE_ID,
  DEFAULT_REMOTE_ROOT,
  MAIN_ID,
  REMOTE_INSTALL_SCRIPT,
  computeDevVersion,
  discoverLatestDevPair,
  installLocalEditors,
  installRemoteHosts,
  parseArgs,
  sanitizeLabel,
  shellQuote,
  validatePrerequisites,
  validatePair
} = require('./dev-install');

test('defaults to a fresh local VS Code install with no remote mutation', () => {
  const options = parseArgs([], {});
  assert.deepEqual(options.editors, [{ command: 'code', label: 'VS Code' }]);
  assert.equal(options.installLocal, true);
  assert.equal(options.packageDev, true);
  assert.equal(options.mainOnly, false);
  assert.deepEqual(options.remotes, []);
  assert.deepEqual(options.remoteRoots, [DEFAULT_REMOTE_ROOT]);
});

test('explicit editor flags replace the default and remote targets are opt-in', () => {
  const options = parseArgs([
    '--editor', 'cursor=Cursor',
    '--editor', '/opt/windsurf=Windsurf',
    '--remote', 'dev-server',
    '--remote-root', '.cursor-server',
    '--label', 'Bridge Test'
  ], {});
  assert.deepEqual(options.editors, [
    { command: 'cursor', label: 'Cursor' },
    { command: '/opt/windsurf', label: 'Windsurf' }
  ]);
  assert.deepEqual(options.remotes, ['dev-server']);
  assert.deepEqual(options.remoteRoots, ['.cursor-server']);
  assert.equal(options.label, 'Bridge Test');
});

test('environment defaults support reusable workstation configuration', () => {
  const options = parseArgs([], {
    CLIHUB_DEV_EDITORS: 'code=VS Code,cursor=Cursor',
    CLIHUB_DEV_REMOTES: 'host-a,host-b',
    CLIHUB_DEV_REMOTE_ROOTS: '.vscode-server,.cursor-server'
  });
  assert.equal(options.editors.length, 2);
  assert.deepEqual(options.remotes, ['host-a', 'host-b']);
  assert.deepEqual(options.remoteRoots, ['.vscode-server', '.cursor-server']);
});

test('explicit remote flags replace environment defaults instead of appending hidden targets', () => {
  const options = parseArgs(['--remote', 'host-b'], { CLIHUB_DEV_REMOTES: 'host-a' });
  assert.deepEqual(options.remotes, ['host-b']);
});

test('rejects unsafe or incomplete mutation targets', () => {
  assert.throws(() => parseArgs(['--no-local'], {}), /Nothing to install/);
  assert.throws(() => parseArgs(['--remote', '-oProxyCommand=bad'], {}), /Invalid SSH host/);
  assert.throws(() => parseArgs(['--main-vsix', 'main.vsix'], {}), /require --skip-package/);
  assert.throws(() => parseArgs(['--skip-package', '--main-vsix', 'main.vsix'], {}), /requires both/);
});

test('preflight reports missing local and remote tooling before mutation', () => {
  const options = parseArgs(['--remote', 'dev-server'], {});
  assert.throws(
    () => validatePrerequisites(options, { PATH: '' }, 'linux'),
    /Required command not found/
  );
});

test('creates a normalized visible dev version above the current patch', () => {
  assert.equal(sanitizeLabel('Bridge Test / Mac'), 'bridge-test-mac');
  assert.equal(computeDevVersion('1.5.3', 'Bridge Test'), '1.5.4-dev.bridge-test');
});

test('discovers the newest complete dev pair and ignores stable or unmatched packages', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clihub-dev-pair-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const files = [
    'cli-hub-1.5.4-dev.old-public.vsix',
    'cli-hub-local-bridge-1.5.4-dev.old-public.vsix',
    'cli-hub-1.5.4-dev.new-public.vsix',
    'cli-hub-local-bridge-1.5.4-dev.new-public.vsix',
    'cli-hub-1.5.4-dev.unmatched-public.vsix',
    'cli-hub-9.9.9-public.vsix',
    'cli-hub-local-bridge-9.9.9-public.vsix'
  ];
  files.forEach((file, index) => {
    const filePath = path.join(tempDir, file);
    fs.writeFileSync(filePath, 'fixture');
    const modified = new Date(1000 + index * 1000);
    fs.utimesSync(filePath, modified, modified);
  });

  const inspect = filePath => {
    const file = path.basename(filePath);
    const bridge = file.startsWith('cli-hub-local-bridge-');
    const version = file.match(/(1\.5\.4-dev\.[a-z]+)/)[1];
    return { path: filePath, id: bridge ? BRIDGE_ID : MAIN_ID, version, manifest: {} };
  };
  const pair = discoverLatestDevPair(tempDir, inspect, false);
  assert.equal(pair.main.version, '1.5.4-dev.new');
  assert.equal(pair.bridge.version, '1.5.4-dev.new');
});

test('rejects mismatched extension identities or versions', () => {
  const main = { id: MAIN_ID, version: '1.5.4-dev.a' };
  assert.throws(() => validatePair({ ...main, id: BRIDGE_ID }, null, true), /Expected/);
  assert.throws(() => validatePair(main, { id: BRIDGE_ID, version: '1.5.4-dev.b' }), /do not match/);
});

test('local install uses exact paired files and verifies installed versions', () => {
  const calls = [];
  const pair = {
    main: { path: '/tmp/main.vsix', id: MAIN_ID, version: '1.5.4-dev.test' },
    bridge: { path: '/tmp/bridge.vsix', id: BRIDGE_ID, version: '1.5.4-dev.test' }
  };
  const options = {
    installLocal: true,
    editors: [{ command: 'fake-code', label: 'Fake Code' }],
    mainOnly: false,
    dryRun: false
  };
  const run = (command, args, runOptions = {}) => {
    calls.push({ command, args, runOptions });
    if (args.includes('--list-extensions')) {
      return { status: 0, stdout: `${MAIN_ID}@${pair.main.version}\n${BRIDGE_ID}@${pair.bridge.version}\n` };
    }
    return { status: 0, stdout: '' };
  };

  installLocalEditors(options, pair, run, () => '/fake/code');
  assert.deepEqual(calls[0].args, ['--install-extension', '/tmp/main.vsix', '--force']);
  assert.deepEqual(calls[1].args, ['--install-extension', '/tmp/bridge.vsix', '--force']);
  assert.ok(calls.some(call => call.args.includes('--list-extensions')));
});

test('main-only mode removes Local Bridge and verifies that it is absent', () => {
  const calls = [];
  const pair = {
    main: { path: '/tmp/main.vsix', id: MAIN_ID, version: '1.5.4-dev.test' },
    bridge: null
  };
  const options = {
    installLocal: true,
    editors: [{ command: 'fake-code', label: 'Fake Code' }],
    mainOnly: true,
    dryRun: false
  };
  const run = (command, args) => {
    calls.push({ command, args });
    if (args.includes('--list-extensions')) {
      return { status: 0, stdout: `${MAIN_ID}@${pair.main.version}\n` };
    }
    return { status: 0, stdout: '' };
  };

  installLocalEditors(options, pair, run, () => '/fake/code');
  assert.ok(calls.some(call => call.args[0] === '--uninstall-extension' && call.args[1] === BRIDGE_ID));
});

test('a failed local editor does not prevent later explicit editors from being attempted', () => {
  const attempted = [];
  const pair = {
    main: { path: '/tmp/main.vsix', id: MAIN_ID, version: '1.5.4-dev.test' },
    bridge: { path: '/tmp/bridge.vsix', id: BRIDGE_ID, version: '1.5.4-dev.test' }
  };
  const options = {
    installLocal: true,
    editors: [{ command: 'bad', label: 'Bad' }, { command: 'good', label: 'Good' }],
    mainOnly: false,
    dryRun: true
  };
  const run = (command, args) => {
    attempted.push(command);
    if (command === '/bad') {
      throw new Error('simulated failure');
    }
    return { status: 0, stdout: '' };
  };

  assert.throws(
    () => installLocalEditors(options, pair, run, command => `/${command}`),
    /Bad: simulated failure/
  );
  assert.ok(attempted.includes('/good'));
});

test('remote install uploads only the main VSIX and sends cleanup script through stdin', () => {
  const calls = [];
  const options = { remotes: ['dev-server'], remoteRoots: ['.vscode-server', '.cursor-server'] };
  const pair = { main: { path: '/tmp/main.vsix', id: MAIN_ID, version: '1.5.4-dev.test' } };
  const run = (command, args, runOptions = {}) => {
    calls.push({ command, args, runOptions });
    return { status: 0, stdout: '' };
  };

  installRemoteHosts(options, pair, run);
  assert.equal(calls[0].command, 'scp');
  assert.equal(calls[0].args[1], '/tmp/main.vsix');
  assert.equal(calls[1].command, 'ssh');
  assert.match(calls[1].args[2], /\.vscode-server/);
  assert.match(calls[1].args[2], /\.cursor-server/);
  assert.match(calls[1].runOptions.input, /trap cleanup EXIT/);
});

test('remote command quoting and script preserve cleanup and atomic staging', () => {
  assert.equal(shellQuote("a'b"), `'a'"'"'b'`);
  assert.match(REMOTE_INSTALL_SCRIPT, /trap cleanup EXIT/);
  assert.match(REMOTE_INSTALL_SCRIPT, /rm -f "\$VSIX"/);
  assert.match(REMOTE_INSTALL_SCRIPT, /staging=/);
  assert.match(REMOTE_INSTALL_SCRIPT, /mv "\$staging" "\$target"/);
  const syntaxCheck = spawnSync('bash', ['-n'], { input: REMOTE_INSTALL_SCRIPT, encoding: 'utf8' });
  assert.equal(syntaxCheck.status, 0, syntaxCheck.stderr);
});
