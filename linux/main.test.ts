import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const handlers = new Map<string, () => void>();
const windows: Array<{
  options: { webPreferences: Record<string, boolean> };
  loadURL: ReturnType<typeof vi.fn>;
  webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}> = [];

afterEach(() => {
  handlers.get('before-quit')?.();
  handlers.clear();
  windows.length = 0;
});

async function startDesktop() {
  const readAsset = vi.fn().mockResolvedValue(Buffer.from('<html>Brain Broccoli</html>'));
  class BrowserWindow {
    loadURL = vi.fn().mockResolvedValue(undefined);
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    constructor(public options: typeof windows[number]['options']) {
      windows.push(this);
    }
    static getAllWindows() { return windows; }
  }
  const app = {
    whenReady: () => Promise.resolve(),
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    quit: vi.fn(),
  };
  const filename = fileURLToPath(new URL('./main.cjs', import.meta.url));
  vm.runInNewContext(await readFile(filename, 'utf8'), {
    require: (name: string) => {
      if (name === 'electron') return { app, BrowserWindow };
      if (name === 'node:fs/promises') return { readFile: readAsset };
      return require(name);
    },
    __dirname: fileURLToPath(new URL('.', import.meta.url)),
    process: { platform: 'darwin' },
    URL,
    console,
  }, { filename });
  await vi.waitFor(() => expect(windows[0]?.loadURL).toHaveBeenCalledOnce());
  return { app, readAsset, window: windows[0]!, origin: windows[0]!.loadURL.mock.calls[0]![0] as string };
}

describe('desktop shell', () => {
  it('uses a sandboxed loopback window and blocks external navigation', async () => {
    const { window, origin } = await startDesktop();
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(window.options.webPreferences).toEqual({
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    });
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    window.webContents.on.mock.calls[0]![1]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('keeps its server available when reopening on macOS', async () => {
    const { app, origin } = await startDesktop();
    handlers.get('window-all-closed')?.();
    expect(app.quit).not.toHaveBeenCalled();
    windows.length = 0;
    handlers.get('activate')?.();
    expect(windows[0]?.loadURL).toHaveBeenCalledWith(origin);
  });

  it('serves the bundle with security headers and prevents directory traversal', async () => {
    const { origin, readAsset } = await startDesktop();
    const response = await fetch(origin);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Brain Broccoli');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    readAsset.mockClear();
    expect((await fetch(`${origin}/..%2fpackage.json`)).status).toBe(403);
    expect((await fetch(`${origin}/%ZZ`)).status).toBe(404);
    expect(readAsset).not.toHaveBeenCalled();
  });
});
