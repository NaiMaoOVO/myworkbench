import { createHash } from 'node:crypto';
import type { AdapterScanContext, AuthorizationGrant, ScanStatus, ScanSummary, SourceAdapter } from './types.js';
import { WorkbenchDatabase } from '../storage/database.js';

export class ScanCoordinator {
  readonly #cancelled = new Set<string>();

  constructor(private readonly database: WorkbenchDatabase, private readonly adapters: Map<string, SourceAdapter>) {}

  requestCancel(sourceId: string): void {
    this.#cancelled.add(sourceId);
  }

  isCancelled(sourceId: string): boolean {
    return this.#cancelled.has(sourceId);
  }

  #contextFor(sourceId: string): AdapterScanContext {
    const database = this.database;
    return {
      previousFileState: (key) => database.getFileState(sourceId, key),
      recordFileState: (key, locatorHash, state) => database.recordFileState(sourceId, key, locatorHash, state.mtimeMs, state.size),
      deleteRecordsForLocator: (locatorHash) => database.deleteEventsForLocatorHash(sourceId, locatorHash),
      forgetFileStatesExcept: (_sourceId: string, keepKeys: string[]) => database.forgetFileStatesExcept(sourceId, keepKeys),
    };
  }

  locatorHash(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  async preview(sourceId: string, grant: AuthorizationGrant) {
    const adapter = this.getAdapter(sourceId);
    return adapter.preview(grant);
  }

  async scan(sourceId: string): Promise<ScanSummary> {
    const adapter = this.getAdapter(sourceId);
    const grant = this.database.getGrant(sourceId);
    const summary = this.database.beginScan(sourceId);
    const health = await adapter.health();

    if (health.state === 'unsupported') {
      summary.status = 'blocked';
      summary.endedAt = new Date().toISOString();
      this.database.addDiagnostic({
        sourceId,
        code: 'ADAPTER_NOT_AVAILABLE',
        severity: 'warning',
        safeMessage: 'This source adapter is not available in the current build.',
        createdAt: summary.endedAt,
      });
      this.database.finishScan(summary);
      return summary;
    }

    if (!grant || grant.revokedAt) {
      summary.status = 'blocked';
      summary.endedAt = new Date().toISOString();
      this.database.finishScan(summary);
      return summary;
    }

    try {
      this.#cancelled.delete(sourceId);
      const context = this.#contextFor(sourceId);
      for await (const item of adapter.scan(grant, undefined, context)) {
        if (this.#cancelled.has(sourceId)) {
          summary.status = 'cancelled';
          summary.endedAt = new Date().toISOString();
          this.database.finishScan(summary);
          return summary;
        }
        if (item.kind === 'diagnostic') {
          summary.failed += 1;
          this.database.addDiagnostic(item.value);
          continue;
        }
        try {
          const normalized = adapter.redact(adapter.normalize(item.value), grant.scope);
          this.database.addEvent(normalized);
          summary.parsed += 1;
        } catch {
          summary.failed += 1;
          this.database.addDiagnostic({
            sourceId,
            code: 'NORMALIZATION_FAILED',
            severity: 'warning',
            safeMessage: 'An imported record could not be normalized.',
            createdAt: new Date().toISOString(),
          });
        }
      }
      this.database.touchGrant(sourceId);
      if (summary.status !== 'cancelled') summary.status = scanStatusFor(summary);
    } catch {
      summary.failed += 1;
      summary.status = summary.parsed > 0 ? 'partial' : 'blocked';
      this.database.addDiagnostic({
        sourceId,
        code: 'SOURCE_SCAN_FAILED',
        severity: 'error',
        safeMessage: 'The source could not be scanned. Check the granted folder and adapter diagnostics.',
        createdAt: new Date().toISOString(),
      });
    }

    summary.endedAt = new Date().toISOString();
    this.database.finishScan(summary);
    return summary;
  }

  private getAdapter(sourceId: string): SourceAdapter {
    const adapter = this.adapters.get(sourceId);
    if (!adapter) throw new Error('Unsupported source adapter.');
    return adapter;
  }
}

function scanStatusFor(summary: ScanSummary): ScanStatus {
  if (summary.failed > 0) return 'partial';
  return 'success';
}
