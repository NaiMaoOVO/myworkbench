import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ContentScope } from '../../src/core/types.js';
import { WorkbenchSourceService } from '../../src/core/source-service.js';
import type { SyncScheduler } from '../../src/core/sync-scheduler.js';
import { discoverCandidates } from '../../src/platform/discover.js';

const sourceIdPattern = /^[a-z0-9-]{1,64}$/;

function assertTrustedSender(event: IpcMainInvokeEvent, uiOrigin: string): void {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || (!senderUrl.startsWith(`${uiOrigin}/`) && senderUrl !== `${uiOrigin}/`)) {
    throw new Error('Untrusted renderer origin.');
  }
}

function assertSourceId(value: unknown): string {
  if (typeof value !== 'string' || !sourceIdPattern.test(value)) throw new Error('Invalid source identifier.');
  return value;
}

function assertScope(value: unknown): ContentScope {
  if (value === 'metadata' || value === 'metadata_and_body') return value;
  throw new Error('Invalid source permission level.');
}

function assertHandle(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid folder selection.');
  return value;
}

function safeError(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : '';
  const safeMessages = new Set([
    'Invalid source identifier.',
    'Invalid source permission level.',
    'Invalid folder selection.',
    'This source adapter is not available in the current build.',
    'An active source authorization is required.',
    'The selected folder is unavailable. Please choose it again.',
  ]);
  return { ok: false, error: safeMessages.has(message) ? message : 'The source operation could not be completed. Review the source selection and try again.' };
}

export function registerSourceIpc(service: WorkbenchSourceService, uiOrigin: string, scheduler?: SyncScheduler): void {
  ipcMain.handle('sources:list', async (event) => {
    try {
      assertTrustedSender(event, uiOrigin);
      return { ok: true, sources: service.list() } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sources:choose-directory', async (event, rawSourceId: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const sourceId = assertSourceId(rawSourceId);
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ['openDirectory', 'dontAddToRecent'] as Array<'openDirectory' | 'dontAddToRecent'> };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length !== 1) return { ok: true, cancelled: true } as const;
      const selectionHandle = await service.createSelection(sourceId, result.filePaths[0]);
      return { ok: true, cancelled: false, selectionHandle } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sources:preview-selection', async (event, rawSourceId: unknown, rawHandle: unknown, rawScope: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const preview = await service.previewSelection(assertSourceId(rawSourceId), assertHandle(rawHandle), assertScope(rawScope));
      return { ok: true, value: preview } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sources:grant', async (event, rawSourceId: unknown, rawHandle: unknown, rawScope: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const grant = await service.grant(assertSourceId(rawSourceId), assertHandle(rawHandle), assertScope(rawScope));
      return { ok: true, grant: { sourceId: grant.sourceId, scope: grant.scope, grantedAt: grant.grantedAt } } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  for (const [channel, action] of [
    ['sources:preview', (sourceId: string) => service.preview(sourceId)],
    ['sources:scan', (sourceId: string) => service.scan(sourceId)],
    ['sources:cancel-scan', (sourceId: string) => { service.cancelScan(sourceId); return Promise.resolve({ cancelled: true }); }],
    ['sources:revoke', (sourceId: string) => service.revoke(sourceId)],
    ['sources:delete-index', (sourceId: string) => service.deleteIndex(sourceId)],
  ] as const) {
    ipcMain.handle(channel, async (event, rawSourceId: unknown) => {
      try {
        assertTrustedSender(event, uiOrigin);
        const value = await action(assertSourceId(rawSourceId));
        return { ok: true, value } as const;
      } catch (error) {
        return safeError(error);
      }
    });
  }

  ipcMain.handle('sources:discover-candidates', async (event) => {
    try {
      assertTrustedSender(event, uiOrigin);
      return { ok: true, value: discoverCandidates() } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sources:grant-directory', async (event, rawSourceId: unknown, rawRoot: unknown, rawScope: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const sourceId = assertSourceId(rawSourceId);
      const scope = assertScope(rawScope);
      if (typeof rawRoot !== 'string' || rawRoot.length === 0 || rawRoot.length > 1024) throw new Error('Invalid folder selection.');
      const handle = await service.createSelection(sourceId, rawRoot);
      const grant = await service.grant(sourceId, handle, scope);
      return { ok: true, grant: { sourceId: grant.sourceId, scope: grant.scope, grantedAt: grant.grantedAt } } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('settings:get', async (event) => {
    try {
      assertTrustedSender(event, uiOrigin);
      return { ok: true, value: { ...service.getSettings(), dataDir: service.dataDirectory() } } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('settings:set', async (event, rawKey: unknown, rawValue: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      if (typeof rawKey !== 'string' || typeof rawValue !== 'string') throw new Error('Invalid setting payload.');
      service.setSetting(rawKey, rawValue);
      if (rawKey === 'scanFrequency') scheduler?.reschedule();
      return { ok: true } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sync:status', async (event) => {
    try {
      assertTrustedSender(event, uiOrigin);
      return { ok: true, value: scheduler?.status() ?? { running: false, lastSyncAt: null, lastError: null } } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sync:run-now', async (event) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const summaries = scheduler ? await scheduler.runNow() : [];
      return { ok: true, value: summaries } as const;
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle('sources:reveal-directory', async (event, rawSourceId: unknown) => {
    try {
      assertTrustedSender(event, uiOrigin);
      const sourceId = assertSourceId(rawSourceId);
      const grantRoot = service.grantedRoot(sourceId);
      if (!grantRoot) throw new Error('An active source authorization is required.');
      const { shell } = await import('electron');
      shell.showItemInFolder(grantRoot);
      return { ok: true } as const;
    } catch (error) {
      return safeError(error);
    }
  });
}
