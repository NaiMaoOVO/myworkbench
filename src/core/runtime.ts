import { createAdapters } from '../adapters/registry.js';
import { ScanCoordinator } from './scanner.js';
import { WorkbenchDatabase } from '../storage/database.js';

export function createWorkbenchRuntime(databasePath: string) {
  const database = new WorkbenchDatabase(databasePath);
  const adapterList = createAdapters();

  for (const adapter of adapterList) {
    const manifest = adapter.manifest();
    database.upsertSource({ id: manifest.id, displayName: manifest.displayName, version: manifest.version });
    if (manifest.version === '0.0.0') database.setSourceState(manifest.id, 'unsupported');
  }

  const adapters = new Map(adapterList.map((adapter) => [adapter.manifest().id, adapter]));
  return { database, adapters, scanner: new ScanCoordinator(database, adapters), catalog: adapterList.map((adapter) => adapter.manifest()) };
}
