import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { LocalApiServer } from '../../src/local-api/server.js';

let localApi: LocalApiServer | undefined;

async function createWindow(): Promise<void> {
  localApi = new LocalApiServer({
    databasePath: join(app.getPath('userData'), 'workbench.sqlite'),
    appOrigin: 'http://127.0.0.1:5173',
  });
  const apiPort = await localApi.start();

  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 320,
    minHeight: 600,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, 'preload.js'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'http://127.0.0.1:5173/') event.preventDefault();
  });
  const uiUrl = process.env.MYWORKBENCH_UI_URL ?? 'http://127.0.0.1:5173/';
  const apiOrigin = encodeURIComponent(`http://127.0.0.1:${apiPort}`);
  await window.loadURL(`${uiUrl}${uiUrl.includes('?') ? '&' : '?'}apiOrigin=${apiOrigin}`);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start MyWorkbench.', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => void localApi?.stop());
