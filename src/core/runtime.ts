import { ExportsCompatibilityAdapter } from '../adapters/exports-adapter.js';
import { ScanCoordinator } from './scanner.js';
import { WorkbenchDatabase } from '../storage/database.js';

export function createWorkbenchRuntime(databasePath: string) {
  const database = new WorkbenchDatabase(databasePath);
  const adapter = new ExportsCompatibilityAdapter();
  database.upsertSource({
    id: adapter.manifest().id,
    displayName: adapter.manifest().displayName,
    version: adapter.manifest().version,
  });
  const adapters = new Map([[adapter.manifest().id, adapter]]);
  return { database, adapters, scanner: new ScanCoordinator(database, adapters) };
}
