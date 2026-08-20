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
    revoke: (sourceId: string) => ipcRenderer.invoke('sources:revoke', sourceId),
    deleteIndex: (sourceId: string) => ipcRenderer.invoke('sources:delete-index', sourceId),
  },
});
