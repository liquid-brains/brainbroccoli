import { packager } from '@electron/packager';
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronManifest = JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
const stagingDirectory = await mkdtemp(path.join(os.tmpdir(), 'brainbroccoli-desktop-'));

try {
  await mkdir(path.join(stagingDirectory, 'linux'));
  await cp(path.join(root, 'linux/main.cjs'), path.join(stagingDirectory, 'linux/main.cjs'));
  await cp(path.join(root, 'dist-linux'), path.join(stagingDirectory, 'dist-linux'), { recursive: true });
  await writeFile(path.join(stagingDirectory, 'package.json'), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    main: 'linux/main.cjs',
  }));
  const outputs = await packager({
    dir: stagingDirectory,
    out: path.join(root, 'dist-desktop'),
    name: 'BrainBroccoli',
    appBundleId: 'org.brainbroccoli.app',
    electronVersion: electronManifest.version,
    asar: true,
    overwrite: true,
  });
  for (const output of outputs) {
    if (process.platform === 'linux') {
      const launcher = path.join(output, 'BrainBroccoli');
      await rename(launcher, path.join(output, 'BrainBroccoli.bin'));
      await cp(path.join(root, 'linux/launch.sh'), launcher);
      await chmod(launcher, 0o755);
    }
    console.log(`Desktop app: ${output}`);
  }
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}
