import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('myWorkbench', {
  platform: process.platform,
  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    chooseDirectory: (sourceId: string) => ipcRenderer.invoke('sources:choose-directory', sourceId),
    previewSelection: (sourceId: string, selectionHandle: string, scope: 'metadata' | 'metadata_and_body') => ipcRenderer.invoke('sources:preview-selection', sourceId, selectionHandle, scope),
    grant: (sourceId: string, selectionHandle: string, scope: 'metadata' | 'metadata_and_body') => ipcRenderer.invoke('sources:grant', sourceId, selectionHandle, scope),
    preview: (sourceId: string) => ipcRenderer.invoke('sources:preview', sourceId),
    scan: (sourceId: string) => ipcRenderer.invoke('sources:scan', sourceId),
    cancelScan: (sourceId: string) => ipcRenderer.invoke('sources:cancel-scan', sourceId),
    revoke: (sourceId: string) => ipcRenderer.invoke('sources:revoke', sourceId),
    deleteIndex: (sourceId: string) => ipcRenderer.invoke('sources:delete-index', sourceId),
    revealDirectory: (sourceId: string) => ipcRenderer.invoke('sources:reveal-directory', sourceId),
    discoverCandidates: () => ipcRenderer.invoke('sources:discover-candidates'),
    grantDirectory: (sourceId: string, root: string, scope: 'metadata' | 'metadata_and_body') => ipcRenderer.invoke('sources:grant-directory', sourceId, root, scope),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    runNow: () => ipcRenderer.invoke('sync:run-now'),
  },
});
