import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

describe('Unit: tool-manifest', () => {
  it('公开 manifest 应包含 opencode 工具定义', () => {
    const manifestPath = path.resolve(__dirname, '../../../config/tool-manifest.public.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Array<Record<string, string>>;

    const opencode = manifest.find(tool => tool.id === 'opencode');

    assert.ok(opencode, 'Expected opencode to be present in the public tool manifest');
    assert.strictEqual(opencode?.label, 'OpenCode');
    assert.strictEqual(opencode?.description, 'Anomaly OpenCode');
    assert.strictEqual(opencode?.command, 'opencode');
    assert.strictEqual(opencode?.packageName, 'opencode-ai');
  });
});
