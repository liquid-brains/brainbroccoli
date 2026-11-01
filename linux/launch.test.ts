import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Linux desktop launcher', () => {
  it.skipIf(process.platform !== 'linux')('starts the packaged binary with the sandbox workaround and forwards arguments', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'brainbroccoli-launcher-test-'));
    const launcher = path.join(directory, 'BrainBroccoli');
    const binary = path.join(directory, 'BrainBroccoli.bin');
    const sourceLauncher = fileURLToPath(new URL('./launch.sh', import.meta.url));

    try {
      await writeFile(binary, '#!/usr/bin/env sh\nprintf "%s\\n" "$@"\n');
      await chmod(binary, 0o755);
      await writeFile(launcher, await readFile(sourceLauncher));
      await chmod(launcher, 0o755);

      const output = execFileSync(launcher, ['--test-argument'], { encoding: 'utf8' });
      expect(output.trim().split('\n')).toEqual(['--no-sandbox', '--test-argument']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
