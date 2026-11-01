import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const withDeviceNetwork = require('./with-device-network.js');

describe('Android device networking', () => {
  it('enables HTTP device access in the generated manifest', async () => {
    const config = withDeviceNetwork({ name: 'Brain Broccoli', slug: 'brainbroccoli' });
    const result = await config.mods.android.manifest({
      ...config,
      modResults: { manifest: { application: [{ $: {} }] } },
      modRequest: { nextMod: (value: unknown) => value },
    });
    expect(result.modResults.manifest.application[0].$['android:usesCleartextTraffic']).toBe('true');
  });
});
