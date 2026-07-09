import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildIterm2WriteTextArgs, buildPathContextText, shouldUseLocalIterm2Bridge } from '../../extension';

function selection(startLine: number, endLine: number, isEmpty = false) {
  return {
    isEmpty,
    start: { line: startLine },
    end: { line: endLine },
  } as any;
}

describe('Unit: Path Context Formatting', () => {
  it('formats a file path without a selection', () => {
    assert.strictEqual(buildPathContextText('src/file.ts', false), 'src/file.ts ');
  });

  it('formats a file path with a single-line selection', () => {
    assert.strictEqual(
      buildPathContextText('src/file.ts', false, selection(2, 2)),
      'src/file.ts L3-3 '
    );
  });

  it('formats a file path with a multi-line selection', () => {
    assert.strictEqual(
      buildPathContextText('src/file.ts', false, selection(2, 7)),
      'src/file.ts L3-8 '
    );
  });

  it('treats an empty selection as no selection', () => {
    assert.strictEqual(
      buildPathContextText('src/file.ts', false, selection(2, 2, true)),
      'src/file.ts '
    );
  });

  it('adds a trailing slash for directories', () => {
    assert.strictEqual(buildPathContextText('src/components', true), 'src/components/ ');
  });

  it('does not duplicate the trailing slash for directories', () => {
    assert.strictEqual(buildPathContextText('src/components/', true), 'src/components/ ');
  });

  it('does not append line numbers for directories', () => {
    assert.strictEqual(
      buildPathContextText('src/components', true, selection(2, 7)),
      'src/components/ '
    );
  });
});

describe('Unit: iTerm2 AppleScript Arguments', () => {
  it('passes text as osascript argv instead of interpolating it into AppleScript', () => {
    const text = 'src/file with "quotes".ts L3-8 \nsecond line';
    const args = buildIterm2WriteTextArgs(text);

    assert.strictEqual(args[0], '-e');
    assert.ok(args[1].includes('on run argv'));
    assert.ok(!args[1].includes(text));
    assert.strictEqual(args[2], text);
  });
});

describe('Unit: Local Bridge Routing', () => {
  it('uses the local bridge only for iTerm2 sends from a remote extension host', () => {
    assert.strictEqual(shouldUseLocalIterm2Bridge('iterm2', 'ssh-remote'), true);
    assert.strictEqual(shouldUseLocalIterm2Bridge('iterm2', undefined), false);
    assert.strictEqual(shouldUseLocalIterm2Bridge('vscodeTerminal', 'ssh-remote'), false);
  });

  it('declares the companion extension as UI-only with hidden command activation', () => {
    const packagePath = path.resolve(__dirname, '../../../extensions/local-bridge/package.json');
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    assert.deepStrictEqual(manifest.extensionKind, ['ui']);
    assert.ok(manifest.activationEvents.includes('onCommand:clihubLocal.writeToIterm2'));
    assert.strictEqual(manifest.contributes?.commands, undefined);
    assert.strictEqual(manifest.publisher, 'MasonHuang');
  });

  it('local bridge rejects newline and control-character payloads', () => {
    const bridge = require('../../../extensions/local-bridge/out/extension') as {
      validateIterm2BridgeText(text: unknown): void;
    };

    assert.doesNotThrow(() => bridge.validateIterm2BridgeText('src/file with spaces.ts L3-8 '));
    assert.throws(() => bridge.validateIterm2BridgeText('src/file.ts\nwhoami'), /control characters/);
    assert.throws(() => bridge.validateIterm2BridgeText('src/file.ts\x1b[200~'), /control characters/);
    assert.throws(() => bridge.validateIterm2BridgeText(''), /non-empty/);
  });
});
