import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(await readFile(new URL('./app.json', import.meta.url), 'utf8')) as {
  expo: { icon: string; web: { favicon: string } };
};

describe('application icons', () => {
  it('uses the standalone broccoli icon for Expo and web icons', () => {
    expect(config.expo.icon).toBe('./assets/app-icon.png');
    expect(config.expo.web.favicon).toBe(config.expo.icon);
  });

  it('keeps the full logo as the in-app image', async () => {
    const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("require('./assets/brain-broccoli.png')");
  });

  it('includes valid Windows and macOS desktop icon files', async () => {
    const [windowsIcon, macOSIcon] = await Promise.all([
      readFile(new URL('./assets/app-icon.ico', import.meta.url)),
      readFile(new URL('./assets/app-icon.icns', import.meta.url)),
    ]);

    expect(windowsIcon.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(macOSIcon.subarray(0, 4).toString('ascii')).toBe('icns');
  });
});
