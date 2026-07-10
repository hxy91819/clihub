#!/usr/bin/env node

const { findMarketplaceReadmeViolations } = require('./validate-release');

const version = process.argv[2];
const maxAttempts = Number(process.env.OPENVSX_VERIFY_ATTEMPTS || 18);
const delayMs = Number(process.env.OPENVSX_VERIFY_DELAY_MS || 10000);
const extensions = ['cli-hub', 'cli-hub-local-bridge'];

if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('Usage: node scripts/verify-open-vsx-release.js <version>');
  process.exit(1);
}

async function fetchChecked(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response;
}

async function verifyExtension(name) {
  const baseUrl = `https://open-vsx.org/api/MasonHuang/${name}/${version}`;
  const metadata = await (await fetchChecked(baseUrl)).json();
  if (metadata.version !== version || metadata.downloadable !== true) {
    throw new Error(`${name}: expected downloadable version ${version}`);
  }

  const readme = await (await fetchChecked(`${baseUrl}/file/README.md`)).text();
  const violations = findMarketplaceReadmeViolations(readme);
  if (violations.length > 0) {
    throw new Error(`${name}: published README contains ${violations.join(', ')}`);
  }
}

async function main() {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await Promise.all(extensions.map(verifyExtension));
      console.log(`Open VSX ${version} is publicly visible for both extensions.`);
      return;
    } catch (error) {
      lastError = error;
      console.log(`Open VSX visibility check ${attempt}/${maxAttempts} pending: ${error.message}`);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  console.error(`Open VSX ${version} did not become publicly visible: ${lastError.message}`);
  process.exit(1);
}

main();
