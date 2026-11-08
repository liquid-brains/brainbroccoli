import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNeuroPro2Device, downloadControllerFiles, runControllerProtocol, saveControllerFiles } from './device';

afterEach(() => vi.unstubAllGlobals());

describe('NeuroPro2 client', () => {
  it('uses brainlight to make read-only requests to the configured device', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '[]',
      json: async () => ['example.vnp2'],
    });
    const device = createNeuroPro2Device(' 192.168.0.58 ', { fetch });

    expect(fetch).not.toHaveBeenCalled();
    expect(await device.listFiles('vnp2')).toEqual(['example.vnp2']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://192.168.0.58/getlistfile?msg=vnp2');
  });

  it('uses the platform fetch by default', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => [], text: async () => '[]',
    });
    vi.stubGlobal('fetch', fetch);
    await createNeuroPro2Device('192.168.0.58').listFiles('vnp2');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['', 'http://192.168.0.58', '256.0.0.1', '1.2.3', '01.2.3.4', '1.2.3.4/path', 'np1.local/x', '-bad.local'])(
    'rejects invalid addresses: %s',
    (ip) => expect(() => createNeuroPro2Device(ip)).toThrow('IPv4 address'),
  );

  it('accepts host names', () => {
    expect(() => createNeuroPro2Device('np1.local')).not.toThrow();
  });

  it('downloads every protocol file from the controller', async () => {
    const fetch = vi.fn(async (url: URL) => {
      const json = url.pathname === '/filedata' ? { single: true } : url.pathname === '/getlistfile' && url.searchParams.get('msg') === 'vnp0' ? ['a.vnp0'] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json };
    });
    const files = await downloadControllerFiles(createNeuroPro2Device('np1.local', { fetch }));
    expect(files.map((file) => file.name)).toEqual(['a.vnp0']);
  });

  it('skips files that are already downloaded', async () => {
    const fetch = vi.fn(async (url: URL) => {
      const json = url.pathname === '/filedata' ? { single: true } : url.pathname === '/getlistfile' && url.searchParams.get('msg') === 'vnp0' ? ['a.vnp0', 'b.vnp0'] : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json };
    });
    const files = await downloadControllerFiles(createNeuroPro2Device('np1.local', { fetch }), undefined, ['A.vnp0']);
    expect(files.map((file) => file.name)).toEqual(['b.vnp0']);
  });

  it('only requests extended Gracefire files when asked', async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname === '/getlistfile') {
        requested.push(url.searchParams.get('msg') ?? '');
      }
      const json = url.pathname === '/filedata' ? { single: true } : [];
      return { ok: true, status: 200, text: async () => JSON.stringify(json), json: async () => json };
    });
    await downloadControllerFiles(createNeuroPro2Device('np1.local', { fetch }));
    expect(requested).not.toContain('vnp2');
    requested.length = 0;
    await downloadControllerFiles(createNeuroPro2Device('np1.local', { fetch }), undefined, [], true);
    expect(requested).toContain('vnp2');
    requested.length = 0;
    await downloadControllerFiles(createNeuroPro2Device('np1.local', { fetch }), undefined, [], true, true);
    expect(requested).toEqual(['vnp2']);
  });

  it('propagates connection failures without sending device commands', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Device offline'));
    await expect(createNeuroPro2Device('192.168.0.58', { fetch }).listFiles('vnp2'))
      .rejects.toThrow('Device offline');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('saveControllerFiles', () => {
  it('sets updateExisting from what the controller already has, without mutating the editor copy', async () => {
    const saveFile = vi.fn().mockResolvedValue(true);
    const listFiles = vi.fn(async (type: string) => (type === 'vnp0' ? ['Old.vnp0'] : []));
    const protocol = { filename: 'a', updateExisting: true };
    const messages: string[] = [];
    await saveControllerFiles(
      { saveFile, listFiles } as never,
      [
        { name: 'old.vnp0', protocol: protocol as never },
        { name: 'new.vnp0', protocol: { filename: 'new', updateExisting: true } as never },
        { name: 'b.vnp4', protocol: { filename: 'b' } as never },
      ],
      (m) => messages.push(m),
    );
    expect(saveFile.mock.calls.map((call) => [call[0], call[1].updateExisting, call[2]])).toEqual([
      ['old.vnp0', true, true],
      ['new.vnp0', false, false],
      ['b.vnp4', false, false],
    ]);
    expect(protocol.updateExisting).toBe(true);
    expect(listFiles.mock.calls.map((call) => call[0])).toEqual(['vnp0', 'vnp3']);
    expect(messages).toHaveLength(3);
  });
});

describe('runControllerProtocol', () => {
  it('runs the file without saving it first', async () => {
    const calls: string[] = [];
    const device = {
      saveFile: async (name: string) => { calls.push(`save ${name}`); },
      runFile: async (name: string) => { calls.push(`run ${name}`); },
    };
    await runControllerProtocol(device as never, 'a.vnp0', new AbortController().signal);
    expect(calls).toEqual(['run a.vnp0']);
  });
});

describe('saveControllerFiles retry', () => {
  it('deletes and re-saves a file when updating it fails', async () => {
    const calls: string[] = [];
    let first = true;
    const device = {
      listFiles: async () => ['a.vnp0'],
      saveFile: async (name: string, _data: unknown, force: boolean) => {
        if (force && first) {
          first = false;
          throw new Error('Request failed with status 400: Failed to update existing file');
        }
        calls.push(`save ${name} ${String(force)}`);
      },
      deleteFile: async (name: string) => { calls.push(`delete ${name}`); return true; },
    };
    await saveControllerFiles(device as never, [{ name: 'a.vnp0', protocol: {} as never }]);
    expect(calls).toEqual(['delete a.vnp0', 'save a.vnp0 false']);
  });
});

