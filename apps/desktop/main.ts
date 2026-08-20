import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { LocalApiServer } from '../../src/local-api/server.js';
import { WorkbenchSourceService } from '../../src/core/source-service.js';
import { registerSourceIpc } from './ipc.js';
import { trustedUiUrl } from '../../src/platform/trusted-ui-url.js';

let localApi: LocalApiServer | undefined;
let sourceService: WorkbenchSourceService | undefined;

async function createWindow(): Promise<void> {
  const uiUrl = trustedUiUrl(process.env.MYWORKBENCH_UI_URL ?? 'http://127.0.0.1:5173/');
  const uiOrigin = uiUrl.origin;
  const databasePath = join(app.getPath('userData'), 'workbench.sqlite');
  localApi = new LocalApiServer({ databasePath, appOrigin: uiOrigin });
  sourceService = new WorkbenchSourceService(databasePath);
  registerSourceIpc(sourceService, uiOrigin);
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${uiOrigin}/`) && url !== `${uiOrigin}/`) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  uiUrl.searchParams.set('apiOrigin', `http://127.0.0.1:${apiPort}`);
  await window.loadURL(uiUrl.toString());
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start MyWorkbench.', error);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  sourceService?.close();
  void localApi?.stop();
});
