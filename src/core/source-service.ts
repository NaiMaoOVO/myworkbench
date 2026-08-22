import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContentScope, ScanPreview, ScanSummary, SourceManifest } from './types.js';
import type { StoredSource } from '../storage/database.js';
import { createWorkbenchRuntime } from './runtime.js';
import { canonicalizeGrantRoot } from '../platform/path-policy.js';

const selectionLifetimeMs = 2 * 60 * 1000;

const allowedSettings = new Set(['scanFrequency', 'launchAtLogin', 'language', 'wizardCompleted']);

export interface DirectorySelection {
  handle: string;
  sourceId: string;
  root: string;
  expiresAt: number;
}

export type PublicSource = Pick<StoredSource, 'id' | 'displayName' | 'version' | 'state' | 'lastScanAt'> & Pick<SourceManifest, 'supportsBodies'>;

export class WorkbenchSourceService {
  readonly #runtime;
  readonly #databasePath: string;
  readonly #selections = new Map<string, DirectorySelection>();

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
    this.#runtime = createWorkbenchRuntime(databasePath);
  }

  /** Directory containing the derived database; safe to show to the local user. */
  dataDirectory(): string {
    return join(this.#databasePath, '..');
  }

  grantedRoot(sourceId: string): string | null {
    this.assertKnown(sourceId);
    return this.#runtime.database.getGrant(sourceId)?.root ?? null;
  }

  close(): void {
    this.#runtime.database.close();
  }

  list(): PublicSource[] {
    const stateById = new Map(this.#runtime.database.listSources().map((source) => [source.id, source]));
    return this.#runtime.catalog.map((manifest) => ({
      ...(stateById.get(manifest.id) ?? { id: manifest.id, displayName: manifest.displayName, version: manifest.version, state: 'undiscovered' as const, lastScanAt: null }),
      supportsBodies: manifest.supportsBodies,
    }));
  }

  async createSelection(sourceId: string, root: string): Promise<string> {
    this.assertAvailable(sourceId);
    const canonicalRoot = await canonicalizeGrantRoot(root);
    const handle = randomUUID();
    this.#selections.set(handle, { handle, sourceId, root: canonicalRoot, expiresAt: Date.now() + selectionLifetimeMs });
    return handle;
  }

  async previewSelection(sourceId: string, selectionHandle: string, scope: ContentScope): Promise<ScanPreview> {
    this.assertAvailable(sourceId);
    const selection = this.peekSelection(sourceId, selectionHandle);
    const temporaryGrant = {
      sourceId,
      root: selection.root,
      scope,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    } as const;
    return this.#runtime.scanner.preview(sourceId, temporaryGrant);
  }

  async grant(sourceId: string, selectionHandle: string, scope: ContentScope) {
    this.assertAvailable(sourceId);
    const selection = this.consumeSelection(sourceId, selectionHandle);
    const previous = this.#runtime.database.getGrant(sourceId);
    if (previous && previous.scope !== scope) {
      // 正文权限变化后必须重建该源记录，增量状态随之失效。
      this.#runtime.database.clearFileStates(sourceId);
    }
    return this.#runtime.database.saveGrant(sourceId, selection.root, scope);
  }

  async preview(sourceId: string): Promise<ScanPreview> {
    this.assertAvailable(sourceId);
    const grant = this.activeGrant(sourceId);
    return this.#runtime.scanner.preview(sourceId, grant);
  }

  async scan(sourceId: string): Promise<ScanSummary> {
    this.assertAvailable(sourceId);
    return this.#runtime.scanner.scan(sourceId);
  }

  cancelScan(sourceId: string): void {
    this.assertKnown(sourceId);
    this.#runtime.scanner.requestCancel(sourceId);
  }

  revoke(sourceId: string): void {
    this.assertAvailable(sourceId);
    this.#runtime.database.revokeGrant(sourceId);
  }

  getSettings(): Record<string, string> {
    return this.#runtime.database.getSettings();
  }

  setSetting(key: string, value: string): void {
    if (!allowedSettings.has(key)) throw new Error('Unsupported setting key.');
    if (value.length > 64 || /[\u0000-\u001f]/.test(value)) throw new Error('Invalid setting value.');
    this.#runtime.database.setSetting(key, value);
  }

  deleteIndex(sourceId: string): void {
    this.assertKnown(sourceId);
    this.#runtime.database.deleteSourceIndex(sourceId);
  }

  private activeGrant(sourceId: string) {
    const grant = this.#runtime.database.getGrant(sourceId);
    if (!grant || grant.revokedAt) throw new Error('An active source authorization is required.');
    return grant;
  }

  private peekSelection(sourceId: string, handle: string): DirectorySelection {
    const selection = this.#selections.get(handle);
    if (!selection || selection.sourceId !== sourceId || selection.expiresAt <= Date.now()) {
      this.#selections.delete(handle);
      throw new Error('The selected folder is unavailable. Please choose it again.');
    }
    return selection;
  }

  private consumeSelection(sourceId: string, handle: string): DirectorySelection {
    const selection = this.peekSelection(sourceId, handle);
    this.#selections.delete(handle);
    return selection;
  }

  private assertKnown(sourceId: string): void {
    if (!this.#runtime.adapters.has(sourceId)) throw new Error('Unsupported source adapter.');
  }

  private assertAvailable(sourceId: string): void {
    this.assertKnown(sourceId);
    const manifest = this.#runtime.adapters.get(sourceId)!.manifest();
    if (manifest.version === '0.0.0') throw new Error('This source adapter is not available in the current build.');
  }
}
