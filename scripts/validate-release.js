#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

const MARKETPLACE_README_RULES = [
  {
    description: 'developer or release section heading',
    pattern: /^#{1,6}\s+(?:Adding a Tool|Developer(?:s| Install| Guide)?|Development|Release Publishing|Contributing|如何添加新的工具|开发者|开发指南|发布流程|贡献)(?:\s|$)/im
  },
  {
    description: 'repository maintenance command or credential name',
    pattern: /(?:npm run|gh secret set|bash \.\/release\.sh|\.github\/workflows|VSCE_PAT|OPENVSX|config\/tool-manifest)/i
  },
  {
    description: 'stale versioned VSIX filename',
    pattern: /cli-hub-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.vsix/i
  }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function findMarketplaceReadmeViolations(content) {
  return MARKETPLACE_README_RULES
    .filter(({ pattern }) => pattern.test(content))
    .map(({ description }) => description);
}

function validateMarketplaceReadme(relativePath) {
  const content = readText(relativePath);
  for (const violation of findMarketplaceReadmeViolations(content)) {
    errors.push(`${relativePath}: contains ${violation}`);
  }
}

function validatePngIcon(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  check(fs.existsSync(absolutePath), `${relativePath}: icon file is missing`);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  const data = fs.readFileSync(absolutePath);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  check(data.length >= 26 && data.subarray(0, 8).equals(pngSignature), `${relativePath}: icon must be a PNG`);
  if (data.length < 26 || !data.subarray(0, 8).equals(pngSignature)) {
    return;
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const colorType = data[25];
  check(width === height, `${relativePath}: icon must be square, got ${width}x${height}`);
  check(width >= 128, `${relativePath}: icon must be at least 128x128, got ${width}x${height}`);
  check(colorType === 4 || colorType === 6, `${relativePath}: PNG must include an alpha channel`);
}

function validateManifestInvariants() {
  const mainPackage = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const bridgePackage = readJson('extensions/local-bridge/package.json');
  const lockRoot = packageLock.packages && packageLock.packages[''];

  check(mainPackage.name === 'cli-hub', `package.json: expected name cli-hub, got ${mainPackage.name}`);
  check(bridgePackage.name === 'cli-hub-local-bridge', `extensions/local-bridge/package.json: unexpected name ${bridgePackage.name}`);
  check(mainPackage.publisher === 'MasonHuang', `package.json: publisher must be MasonHuang, got ${mainPackage.publisher}`);
  check(bridgePackage.publisher === 'MasonHuang', `extensions/local-bridge/package.json: publisher must be MasonHuang, got ${bridgePackage.publisher}`);
  check(mainPackage.version === bridgePackage.version, `extension versions differ: main=${mainPackage.version}, bridge=${bridgePackage.version}`);
  check(mainPackage.version === packageLock.version, `package-lock.json version differs: package=${mainPackage.version}, lock=${packageLock.version}`);
  check(lockRoot && mainPackage.version === lockRoot.version, `package-lock.json root version differs from package.json`);
  check(mainPackage.icon === 'icons/cli-hub-icon.png', `package.json: main icon must use icons/cli-hub-icon.png`);
  check(bridgePackage.icon === 'icons/cli-hub-local-bridge-icon.png', `local bridge: icon must use icons/cli-hub-local-bridge-icon.png`);
  check(mainPackage.scripts && mainPackage.scripts['validate:release'] === 'node ./scripts/validate-release.js', 'package.json: validate:release script is missing or changed');

  validatePngIcon(mainPackage.icon);
  validatePngIcon(path.join('extensions/local-bridge', bridgePackage.icon));
}

function validateDocumentationBoundary() {
  validateMarketplaceReadme('README.md');
  validateMarketplaceReadme('README.zh-CN.md');
  validateMarketplaceReadme('extensions/local-bridge/README.md');

  const bridgeReadme = readText('extensions/local-bridge/README.md');
  check(/Remote SSH/i.test(bridgeReadme), 'local bridge README must explain the Remote SSH use case');
  check(/clihub\.pathSendTarget/.test(bridgeReadme), 'local bridge README must explain clihub.pathSendTarget');
  check(/iTerm2/.test(bridgeReadme), 'local bridge README must explain the iTerm2 target');
  check(!/clihubLocal\.writeToIterm2|hidden command|registers? the command/i.test(bridgeReadme), 'local bridge README must not expose implementation-only commands');

  const developmentDoc = readText('docs/development-and-release.md');
  for (const requiredText of ['## 本地开发', '## 测试安装', '## 正式打包', '## CI 发布', 'VSCE_PAT', 'OPENVSX']) {
    check(developmentDoc.includes(requiredText), `docs/development-and-release.md: missing ${requiredText}`);
  }
}

function validatePackagingBoundary() {
  const vscodeIgnore = readText('.vscodeignore');
  for (const requiredPattern of [
    '.github/**',
    'docs/**',
    'extensions/**',
    'openspec/**',
    'config/tool-manifest.internal.json',
    'icons/cli-hub-icon-a.svg',
    'scripts/install-dev-vsix.sh',
    'scripts/install-everywhere.sh',
    'scripts/validate-release.js',
    'scripts/validate-vsix-contents.js',
    'scripts/verify-open-vsx-release.js'
  ]) {
    check(vscodeIgnore.includes(requiredPattern), `.vscodeignore: missing ${requiredPattern}`);
  }
}

function validateReleaseWorkflow() {
  const workflow = readText('.github/workflows/release.yml');
  for (const requiredText of [
    'build-release:',
    'publish-vscode-marketplace:',
    'publish-open-vsx:',
    'secrets.VSCE_PAT',
    'secrets.OPENVSX',
    'workflow_dispatch:',
    '--skip-duplicate',
    'actions/upload-artifact@',
    'npm run validate:release',
    'scripts/verify-open-vsx-release.js',
    'PUBLISH_FAILURES'
  ]) {
    check(workflow.includes(requiredText), `.github/workflows/release.yml: missing ${requiredText}`);
  }

  function getJobBlock(jobName) {
    const marker = `  ${jobName}:`;
    const start = workflow.indexOf(marker);
    if (start < 0) {
      return '';
    }
    const remaining = workflow.slice(start + marker.length);
    const nextJob = /\n  [0-9A-Za-z_-]+:\n/.exec(remaining);
    const end = nextJob ? start + marker.length + nextJob.index : workflow.length;
    return workflow.slice(start, end);
  }

  const buildBlock = getJobBlock('build-release');
  const vscodeBlock = getJobBlock('publish-vscode-marketplace');
  const openVsxBlock = getJobBlock('publish-open-vsx');
  check(buildBlock.length > 0 && vscodeBlock.length > 0 && openVsxBlock.length > 0, 'release workflow must keep three separate release jobs');
  if (buildBlock.length > 0) {
    check(!/VSCE_PAT|OVSX_PAT|ovsx publish|vsce publish/.test(buildBlock), 'build-release job must not publish to a marketplace');
  }
  check(vscodeBlock.includes('needs: build-release'), 'VS Code Marketplace job must depend only on build-release');
  check(openVsxBlock.includes('needs: build-release'), 'Open VSX job must depend only on build-release');
  for (const [name, block] of [['VS Code Marketplace', vscodeBlock], ['Open VSX', openVsxBlock]]) {
    check(block.includes('for ATTEMPT in 1 2 3'), `${name} job must retry each VSIX`);
    check(block.includes('PUBLISH_FAILURES'), `${name} job must aggregate failures after attempting both VSIX files`);
    check(block.includes('--skip-duplicate'), `${name} job must support safe reruns`);
  }

  const ciWorkflow = readText('.github/workflows/ci.yml');
  check(ciWorkflow.includes('npm run validate:release'), '.github/workflows/ci.yml: release validation step is missing');
  const releaseScript = readText('release.sh');
  check(releaseScript.includes('npm run validate:release'), 'release.sh: release validation step is missing');
  check(releaseScript.includes('scripts/validate-vsix-contents.js'), 'release.sh: packaged VSIX content validation is missing');
}

function main() {
  validateManifestInvariants();
  validateDocumentationBoundary();
  validatePackagingBoundary();
  validateReleaseWorkflow();

  if (errors.length > 0) {
    console.error('Release validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Release validation passed.');
}

module.exports = {
  findMarketplaceReadmeViolations
};

if (require.main === module) {
  main();
}
