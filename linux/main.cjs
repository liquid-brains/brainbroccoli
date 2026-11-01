const { app, BrowserWindow, ipcMain } = require('electron');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const bundleDirectory = path.resolve(__dirname, '../dist-linux');
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

const deviceReadPaths = new Set(['/getlistfile', '/getlistbatchfile', '/filedata', '/batchfiledata']);

ipcMain.handle('device-request', async (_event, urlText) => {
  const url = new URL(urlText);
  if (url.protocol !== 'http:' || !deviceReadPaths.has(url.pathname)) {
    throw new Error('Unsupported controller request.');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return { ok: response.ok, status: response.status, body: await response.text() };
});

let server;
let origin;

async function startServer() {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = path.resolve(bundleDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
      const relative = path.relative(bundleDirectory, filename);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  // A stable origin keeps localStorage (settings and downloaded files) between launches.
  const listen = (port) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await listen(47615).catch(() => listen(0));
  origin = `http://127.0.0.1:${server.address().port}`;
}

function openWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 420,
    minHeight: 700,
    title: 'Brain Broccoli',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadURL(origin);
}

app.whenReady().then(async () => {
  await startServer();
  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => server?.close());
