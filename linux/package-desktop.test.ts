import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('packages the preload script that exposes the controller bridge', async () => {
  const script = await readFile(new URL('../scripts/package-desktop.mjs', import.meta.url), 'utf8');
  expect(script).toContain("'linux/preload.cjs'");
});
