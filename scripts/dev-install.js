#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const semver = require('semver');

const ROOT = path.resolve(__dirname, '..');
const MAIN_ID = 'masonhuang.cli-hub';
const BRIDGE_ID = 'masonhuang.cli-hub-local-bridge';
const DEFAULT_EDITOR = 'code=VS Code';
const DEFAULT_REMOTE_ROOT = '.vscode-server';

const REMOTE_INSTALL_SCRIPT = fs.readFileSync(path.join(__dirname, 'dev-remote-install.sh'), 'utf8');

function usage() {
  return `Configurable developer installer for CLI Hub.

Usage:
  npm run dev:install -- [options]
  node ./scripts/dev-install.js [options]

Default behavior:
  Build a fresh paired Dev VSIX, then install the main extension and Local Bridge
  into local VS Code only. No remote host or global AI CLI is modified.

Options:
  --editor <cli[=label]>   Local VS Code-like IDE CLI. Repeatable.
                           First use replaces the default "code=VS Code".
  --remote <ssh-host>      Remote SSH host for the main extension. Repeatable.
  --remote-root <path>     Remote server root. Repeatable. Default: ${DEFAULT_REMOTE_ROOT}
  --no-local               Skip all local IDE installs.
  --main-only              Install only the main extension and remove Local Bridge locally.
  --skip-package           Reuse the newest matching Dev VSIX pair in the repo root.
  --main-vsix <path>       Explicit main VSIX; requires --skip-package.
  --bridge-vsix <path>     Explicit Local Bridge VSIX; requires --skip-package unless --main-only.
  --label <label>          Readable Dev version suffix. Default: local timestamp.
  --dry-run                Validate configuration and print mutations without executing them.
  -h, --help               Show this help.

Environment defaults:
  CLIHUB_DEV_EDITORS       Comma-separated editor specs.
  CLIHUB_DEV_REMOTES       Comma-separated SSH hosts.
  CLIHUB_DEV_REMOTE_ROOTS  Comma-separated remote server roots.

Examples:
  npm run dev:install
  npm run dev:install -- --editor cursor=Cursor
  npm run dev:install -- --editor code --editor cursor --label bridge-test
  npm run dev:install -- --remote dev-server --remote-root .vscode-server
  npm run dev:install -- --editor cursor --remote dev-server --remote-root .cursor-server
  npm run dev:install -- --skip-package --dry-run
`;
}

function splitCsv(value) {
  return (value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function parseEditorSpec(value) {
  const separator = value.indexOf('=');
  const command = (separator >= 0 ? value.slice(0, separator) : value).trim();
  const label = (separator >= 0 ? value.slice(separator + 1) : value).trim() || command;
  if (!command || /[\r\n\0]/.test(command) || /[\r\n\0]/.test(label)) {
    throw new Error(`Invalid editor spec: ${value}`);
  }
  return { command, label };
}

function parseArgs(argv, env = process.env) {
  const envEditors = splitCsv(env.CLIHUB_DEV_EDITORS);
  const options = {
    editors: (envEditors.length > 0 ? envEditors : [DEFAULT_EDITOR]).map(parseEditorSpec),
    remotes: splitCsv(env.CLIHUB_DEV_REMOTES),
    remoteRoots: splitCsv(env.CLIHUB_DEV_REMOTE_ROOTS),
    installLocal: true,
    mainOnly: false,
    packageDev: true,
    mainVsix: '',
    bridgeVsix: '',
    label: '',
    dryRun: false,
    help: false
  };
  let editorFlagSeen = false;
  let remoteFlagSeen = false;
  let remoteRootFlagSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };

    switch (arg) {
      case '--editor':
        if (!editorFlagSeen) {
          options.editors = [];
          editorFlagSeen = true;
        }
        options.editors.push(parseEditorSpec(nextValue()));
        break;
      case '--remote':
        if (!remoteFlagSeen) {
          options.remotes = [];
          remoteFlagSeen = true;
        }
        options.remotes.push(nextValue());
        break;
      case '--remote-root':
        if (!remoteRootFlagSeen) {
          options.remoteRoots = [];
          remoteRootFlagSeen = true;
        }
        options.remoteRoots.push(nextValue());
        break;
      case '--no-local':
        options.installLocal = false;
        break;
      case '--main-only':
        options.mainOnly = true;
        break;
      case '--skip-package':
        options.packageDev = false;
        break;
      case '--main-vsix':
        options.mainVsix = nextValue();
        break;
      case '--bridge-vsix':
        options.bridgeVsix = nextValue();
        break;
      case '--label':
        options.label = nextValue();
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.remotes = [...new Set(options.remotes)];
  options.remoteRoots = [...new Set(options.remoteRoots.length > 0 ? options.remoteRoots : [DEFAULT_REMOTE_ROOT])];

  for (const remote of options.remotes) {
    if (!remote || remote.startsWith('-') || /[\s\r\n\0]/.test(remote)) {
      throw new Error(`Invalid SSH host: ${remote}`);
    }
  }
  for (const root of options.remoteRoots) {
    if (!root || /[\r\n\0]/.test(root)) {
      throw new Error(`Invalid remote root: ${root}`);
    }
  }
  if (!options.installLocal && options.remotes.length === 0 && !options.help) {
    throw new Error('Nothing to install: --no-local requires at least one --remote host');
  }
  if (options.installLocal && options.editors.length === 0 && !options.help) {
    throw new Error('At least one local editor is required unless --no-local is used');
  }
  if ((options.mainVsix || options.bridgeVsix) && options.packageDev) {
    throw new Error('--main-vsix and --bridge-vsix require --skip-package');
  }
  if (!options.packageDev && Boolean(options.mainVsix) !== Boolean(options.bridgeVsix) && !options.mainOnly) {
    throw new Error('Explicit reuse requires both --main-vsix and --bridge-vsix');
  }

  return options;
}

function sanitizeLabel(value) {
  const sanitized = value.toLowerCase().replace(/[^0-9a-z-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitized) {
    throw new Error('Dev label must contain at least one alphanumeric character');
  }
  return sanitized;
}

function defaultLabel(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `local-${timestamp}`;
}

function computeDevVersion(baseVersion, label) {
  const nextVersion = semver.inc(baseVersion, 'patch');
  if (!nextVersion) {
    throw new Error(`Invalid base version: ${baseVersion}`);
  }
  return `${nextVersion}-dev.${sanitizeLabel(label)}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function createRunner({ dryRun = false } = {}) {
  return function run(command, args, options = {}) {
    console.log(`$ ${formatCommand(command, args)}`);
    if (dryRun) {
      return { status: 0, stdout: '', stderr: '' };
    }
    const shouldCapture = options.capture || options.quiet;
    const result = spawnSync(command, args, {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      input: options.input,
      encoding: 'utf8',
      stdio: shouldCapture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit']
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0 && !options.allowFailure) {
      const detail = shouldCapture && result.stderr ? `\n${result.stderr.trim()}` : '';
      throw new Error(`Command failed (${result.status}): ${formatCommand(command, args)}${detail}`);
    }
    return result;
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function inspectVsix(vsixPath) {
  const absolutePath = path.resolve(ROOT, vsixPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`VSIX not found: ${absolutePath}`);
  }
  const result = spawnSync('unzip', ['-p', absolutePath, 'extension/package.json'], { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Unable to read extension/package.json from ${absolutePath}`);
  }
  const manifest = JSON.parse(result.stdout);
  return {
    path: absolutePath,
    id: `${manifest.publisher}.${manifest.name}`.toLowerCase(),
    version: manifest.version,
    manifest
  };
}

function validatePair(main, bridge, mainOnly = false) {
  if (main.id !== MAIN_ID) {
    throw new Error(`Expected ${MAIN_ID}, got ${main.id}`);
  }
  if (mainOnly) {
    return;
  }
  if (!bridge) {
    throw new Error('Local Bridge VSIX is required unless --main-only is used');
  }
  if (bridge.id !== BRIDGE_ID) {
    throw new Error(`Expected ${BRIDGE_ID}, got ${bridge.id}`);
  }
  if (main.version !== bridge.version) {
    throw new Error(`VSIX versions do not match: main=${main.version}, bridge=${bridge.version}`);
  }
}

function discoverLatestDevPair(rootDir = ROOT, inspect = inspectVsix, mainOnly = false) {
  const files = fs.readdirSync(rootDir);
  const mainPattern = /^cli-hub-((?:[0-9]+\.){2}[0-9]+-dev\.[0-9A-Za-z.-]+)-public\.vsix$/;
  const bridgePattern = /^cli-hub-local-bridge-((?:[0-9]+\.){2}[0-9]+-dev\.[0-9A-Za-z.-]+)-public\.vsix$/;
  const mains = new Map();
  const bridges = new Map();

  for (const file of files) {
    let match = mainPattern.exec(file);
    if (match) {
      mains.set(match[1], path.join(rootDir, file));
      continue;
    }
    match = bridgePattern.exec(file);
    if (match) {
      bridges.set(match[1], path.join(rootDir, file));
    }
  }

  const candidates = [...mains.keys()]
    .filter(version => mainOnly || bridges.has(version))
    .map(version => ({
      version,
      mainPath: mains.get(version),
      bridgePath: bridges.get(version),
      modifiedAt: Math.min(
        fs.statSync(mains.get(version)).mtimeMs,
        mainOnly ? Number.MAX_SAFE_INTEGER : fs.statSync(bridges.get(version)).mtimeMs
      )
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  if (candidates.length === 0) {
    throw new Error('No matching Dev VSIX pair found. Run without --skip-package or provide explicit paths.');
  }

  const selected = candidates[0];
  const main = inspect(selected.mainPath);
  const bridge = mainOnly ? null : inspect(selected.bridgePath);
  validatePair(main, bridge, mainOnly);
  return { main, bridge };
}

function packageDevBuild(options, run) {
  const sourcePackage = readJson('package.json');
  const bridgePackage = readJson('extensions/local-bridge/package.json');
  const label = sanitizeLabel(options.label || defaultLabel());
  const version = computeDevVersion(sourcePackage.version, label);
  const mainPath = path.join(ROOT, `cli-hub-${version}-public.vsix`);
  const bridgePath = path.join(ROOT, `cli-hub-local-bridge-${version}-public.vsix`);

  run('bash', ['./release.sh', sourcePackage.version, '--force', '--channel', 'public', '--dev-build', label]);

  if (options.dryRun) {
    const mainManifest = { ...sourcePackage, version };
    const localBridgeManifest = { ...bridgePackage, version };
    return {
      main: { path: mainPath, id: MAIN_ID, version, manifest: mainManifest },
      bridge: { path: bridgePath, id: BRIDGE_ID, version, manifest: localBridgeManifest }
    };
  }

  const main = inspectVsix(mainPath);
  const bridge = inspectVsix(bridgePath);
  validatePair(main, bridge, false);
  return { main, bridge };
}

function selectVsixPair(options, run) {
  if (options.packageDev) {
    return packageDevBuild(options, run);
  }
  if (options.mainVsix) {
    const main = inspectVsix(options.mainVsix);
    const bridge = options.mainOnly ? null : inspectVsix(options.bridgeVsix);
    validatePair(main, bridge, options.mainOnly);
    return { main, bridge };
  }
  return discoverLatestDevPair(ROOT, inspectVsix, options.mainOnly);
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(command, env = process.env, platform = process.platform) {
  const pathEntries = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(pathEntry, platform === 'win32' ? `${command}${extension}` : command);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

function resolveEditorCommand(command, platform = process.platform, env = process.env) {
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    const absolutePath = path.resolve(command);
    if (isExecutable(absolutePath)) {
      return absolutePath;
    }
    throw new Error(`Editor CLI not found or not executable: ${absolutePath}`);
  }

  const onPath = findOnPath(command, env, platform);
  if (onPath) {
    return onPath;
  }

  if (platform === 'darwin') {
    const knownCommands = {
      code: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      'code-insiders': '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
      cursor: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      windsurf: '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'
    };
    const candidate = knownCommands[command];
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Editor CLI not found: ${command}. Pass an executable path with --editor.`);
}

function validatePrerequisites(options, env = process.env, platform = process.platform) {
  const requiredCommands = new Set(['unzip']);
  if (options.packageDev) {
    requiredCommands.add('bash');
    requiredCommands.add('python3');
  }
  if (options.remotes.length > 0) {
    requiredCommands.add('ssh');
    requiredCommands.add('scp');
  }
  for (const command of requiredCommands) {
    if (!findOnPath(command, env, platform)) {
      throw new Error(`Required command not found: ${command}`);
    }
  }
}

function installLocalEditors(options, pair, run, resolveEditor = resolveEditorCommand) {
  if (!options.installLocal) {
    return;
  }

  const failures = [];
  for (const editor of options.editors) {
    try {
      const editorCli = resolveEditor(editor.command);
      console.log(`\nInstalling into local ${editor.label}`);
      run(editorCli, ['--install-extension', pair.main.path, '--force']);

      if (options.mainOnly) {
        run(editorCli, ['--uninstall-extension', BRIDGE_ID], { allowFailure: true, quiet: true });
      } else {
        run(editorCli, ['--install-extension', pair.bridge.path, '--force']);
      }
      run(editorCli, ['--uninstall-extension', 'clihub.cli-hub'], { allowFailure: true, quiet: true });

      if (!options.dryRun) {
        const result = run(editorCli, ['--list-extensions', '--show-versions'], { capture: true });
        const installed = new Set(result.stdout.toLowerCase().split(/\r?\n/).map(line => line.trim()).filter(Boolean));
        if (!installed.has(`${MAIN_ID}@${pair.main.version}`)) {
          throw new Error('main extension version verification failed');
        }
        if (!options.mainOnly && !installed.has(`${BRIDGE_ID}@${pair.bridge.version}`)) {
          throw new Error('Local Bridge version verification failed');
        }
        if (options.mainOnly && [...installed].some(extension => extension.startsWith(`${BRIDGE_ID}@`))) {
          throw new Error('Local Bridge is still installed in --main-only mode');
        }
        console.log(`Verified ${MAIN_ID}@${pair.main.version}${options.mainOnly ? '' : ` and ${BRIDGE_ID}@${pair.bridge.version}`}`);
      }
    } catch (error) {
      failures.push(`${editor.label}: ${error.message}`);
      console.error(`Local install failed for ${editor.label}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Local editor failures: ${failures.join('; ')}`);
  }
}

function installRemoteHosts(options, pair, run) {
  const failures = [];
  for (const host of options.remotes) {
    try {
      const remoteVsix = `/tmp/clihub-dev-${process.pid}-${Date.now()}-${path.basename(pair.main.path)}`;
      console.log(`\nInstalling main extension on remote host ${host}`);
      run('scp', ['--', pair.main.path, `${host}:${remoteVsix}`]);
      const remoteArgs = [remoteVsix, pair.main.id, pair.main.version, ...options.remoteRoots];
      const remoteCommand = `bash -s -- ${remoteArgs.map(shellQuote).join(' ')}`;
      run('ssh', ['--', host, remoteCommand], { input: REMOTE_INSTALL_SCRIPT });
    } catch (error) {
      failures.push(`${host}: ${error.message}`);
      console.error(`Remote install failed for ${host}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Remote host failures: ${failures.join('; ')}`);
  }
}

function summarize(options, pair) {
  console.log('\nDeveloper install summary');
  console.log(`  Version: ${pair.main.version}`);
  console.log(`  Main VSIX: ${pair.main.path}`);
  console.log(`  Bridge VSIX: ${options.mainOnly ? 'skipped' : pair.bridge.path}`);
  console.log(`  Local editors: ${options.installLocal ? options.editors.map(editor => editor.label).join(', ') : 'skipped'}`);
  console.log(`  Remote hosts: ${options.remotes.length > 0 ? options.remotes.join(', ') : 'none'}`);
  if (options.remotes.length > 0) {
    console.log(`  Remote roots: ${options.remoteRoots.join(', ')}`);
  }
  console.log(options.dryRun ? '  Mode: dry-run (no mutations executed)' : '  Reload affected IDE windows to activate the installed build.');
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return;
    }
    const run = createRunner({ dryRun: options.dryRun });
    validatePrerequisites(options);
    const pair = selectVsixPair(options, run);
    validatePair(pair.main, pair.bridge, options.mainOnly);
    const installFailures = [];
    try {
      installLocalEditors(options, pair, run);
    } catch (error) {
      installFailures.push(error.message);
    }
    try {
      installRemoteHosts(options, pair, run);
    } catch (error) {
      installFailures.push(error.message);
    }
    if (installFailures.length > 0) {
      throw new Error(installFailures.join(' | '));
    }
    summarize(options, pair);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BRIDGE_ID,
  DEFAULT_EDITOR,
  DEFAULT_REMOTE_ROOT,
  MAIN_ID,
  REMOTE_INSTALL_SCRIPT,
  computeDevVersion,
  createRunner,
  defaultLabel,
  discoverLatestDevPair,
  formatCommand,
  installLocalEditors,
  installRemoteHosts,
  parseArgs,
  parseEditorSpec,
  resolveEditorCommand,
  sanitizeLabel,
  shellQuote,
  usage,
  validatePrerequisites,
  validatePair
};

if (require.main === module) {
  main();
}
