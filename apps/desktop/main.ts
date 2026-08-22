import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { LocalApiServer } from '../../src/local-api/server.js';
import { WorkbenchSourceService } from '../../src/core/source-service.js';
import { registerSourceIpc } from './ipc.js';
import { trustedUiUrl } from '../../src/platform/trusted-ui-url.js';

let localApi: LocalApiServer | undefined;
let sourceService: WorkbenchSourceService | undefined;

async function createWindow(): Promise<void> {
  // Packaged builds host the built UI from app resources on the same loopback
  // origin as the API; dev builds load an explicit loopback UI URL.
  // An empty-string variable must fall back to the default like an unset one.
  const overrideEnv = process.env.MYWORKBENCH_UI_URL?.trim() || undefined;
  const packagedSelfHosted = app.isPackaged && !overrideEnv;
  const uiRoot = packagedSelfHosted ? join(app.getAppPath(), 'dist-web') : undefined;
  const placeholderOrigin = 'http://127.0.0.1:65535';
  const initialOrigin = packagedSelfHosted ? placeholderOrigin : trustedUiUrl(overrideEnv ?? 'http://127.0.0.1:5173/').origin;
  const databasePath = join(app.getPath('userData'), 'workbench.sqlite');
  localApi = new LocalApiServer({ databasePath, appOrigin: initialOrigin, uiRoot });
  sourceService = new WorkbenchSourceService(databasePath);
  const apiPort = await localApi.start();
  if (packagedSelfHosted) {
    // The real origin depends on the ephemeral port chosen in start(); the
    // security fields are only read per-request, so updating here is safe.
    localApi.security.appOrigin = `http://127.0.0.1:${apiPort}`;
  }
  registerSourceIpc(sourceService, localApi.security.appOrigin);
  const uiUrl = packagedSelfHosted ? new URL(`http://127.0.0.1:${apiPort}/`) : trustedUiUrl(overrideEnv!);
  const uiOrigin = uiUrl.origin;

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
      preload: join(import.meta.dirname, '../../preload.js'),
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
