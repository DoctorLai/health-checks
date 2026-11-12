import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it('builds a versioned runtime ZIP with matching metadata and no local secrets or developer artifacts', async () => {
  await import('../scripts/build.cjs');
  const sourceManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const filename = path.join(root, 'dist', `health-checks-${sourceManifest.version}.zip`);
  const files = unzipSync(readFileSync(filename));
  const manifest = JSON.parse(strFromU8(files['package.json']));
  const lock = JSON.parse(strFromU8(files['package-lock.json']));
  expect(manifest).toEqual(sourceManifest);
  expect(lock.packages[''].version).toBe(manifest.version);
  expect(Buffer.from(files['health-check.js'])).toEqual(
    readFileSync(path.join(root, 'health-check.js')),
  );
  expect(JSON.parse(strFromU8(files['config.json.sample'])).email.enabled).toBe(false);
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining(['README.md', 'SECURITY.md', 'SUPPORT.md', 'PRIVACY.md', '.nvmrc']),
  );
  expect(Object.keys(files)).not.toContain('config.json');
  expect(
    Object.keys(files).some((file) =>
      /(^|\/)(node_modules|coverage|dist|test|\.git|\.env)/.test(file),
    ),
  ).toBe(false);
});
