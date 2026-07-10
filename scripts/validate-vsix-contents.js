#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findMarketplaceReadmeViolations } = require('./validate-release');

const ROOT = path.resolve(__dirname, '..');
const [mainVsixArg, bridgeVsixArg] = process.argv.slice(2);
const errors = [];

if (!mainVsixArg || !bridgeVsixArg) {
  console.error('Usage: node scripts/validate-vsix-contents.js <main.vsix> <bridge.vsix>');
  process.exit(1);
}

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function unzip(vsixPath, args) {
  try {
    return execFileSync('unzip', [...args, vsixPath], { encoding: 'utf8' });
  } catch (error) {
    console.error(`Unable to inspect ${vsixPath}; ensure unzip is installed.`);
    throw error;
  }
}

function listEntries(vsixPath) {
  return unzip(vsixPath, ['-Z1']).trim().split('\n').filter(Boolean);
}

function readEntry(vsixPath, entry) {
  return execFileSync('unzip', ['-p', vsixPath, entry], { encoding: 'utf8' });
}

function validatePackage(vsixArg, expectedPackage, kind) {
  const vsixPath = path.resolve(ROOT, vsixArg);
  check(fs.existsSync(vsixPath), `${kind}: VSIX is missing: ${vsixArg}`);
  if (!fs.existsSync(vsixPath)) {
    return;
  }

  const entries = listEntries(vsixPath);
  const entrySet = new Set(entries);
  for (const requiredEntry of [
    'extension/package.json',
    'extension/README.md',
    'extension/out/extension.js',
    `extension/${expectedPackage.icon}`
  ]) {
    check(entrySet.has(requiredEntry), `${kind}: missing packaged file ${requiredEntry}`);
  }
  if (expectedPackage.name === 'cli-hub') {
    for (const runtimeEntry of ['extension/config/tool-manifest.json', 'extension/scripts/fix-codebuddy.sh']) {
      check(entrySet.has(runtimeEntry), `${kind}: missing runtime file ${runtimeEntry}`);
    }
  }

  const forbiddenEntries = entries.filter(entry =>
    entry === 'extension/config/tool-manifest.internal.json' ||
    entry === 'extension/AGENTS.md' ||
    entry === 'extension/release.sh' ||
    entry === 'extension/icons/cli-hub-icon-a.svg' ||
    entry.startsWith('extension/.github/') ||
    entry.startsWith('extension/docs/') ||
    entry.startsWith('extension/openspec/') ||
    (entry.startsWith('extension/scripts/') && entry !== 'extension/scripts/fix-codebuddy.sh')
  );
  check(forbiddenEntries.length === 0, `${kind}: contains development/private files: ${forbiddenEntries.join(', ')}`);

  if (entrySet.has('extension/package.json')) {
    const packagedManifest = JSON.parse(readEntry(vsixPath, 'extension/package.json'));
    check(packagedManifest.name === expectedPackage.name, `${kind}: packaged name differs from source manifest`);
    check(packagedManifest.version === expectedPackage.version, `${kind}: packaged version differs from source manifest`);
    check(packagedManifest.publisher === expectedPackage.publisher, `${kind}: packaged publisher differs from source manifest`);
  }

  if (entrySet.has('extension/README.md')) {
    const readme = readEntry(vsixPath, 'extension/README.md');
    const violations = findMarketplaceReadmeViolations(readme);
    check(violations.length === 0, `${kind}: packaged README contains ${violations.join(', ')}`);
  }
}

const mainPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const bridgePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'extensions/local-bridge/package.json'), 'utf8'));

validatePackage(mainVsixArg, mainPackage, 'main extension');
validatePackage(bridgeVsixArg, bridgePackage, 'local bridge');

if (errors.length > 0) {
  console.error('VSIX content validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('VSIX content validation passed.');
