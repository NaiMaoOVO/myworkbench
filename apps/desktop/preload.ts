import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('myWorkbench', {
  platform: process.platform,
});
