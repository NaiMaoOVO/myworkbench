import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuthorizationGrant, Diagnostic, NormalizedRecord, ScanStatus, ScanSummary, SourceState } from '../core/types.js';

export interface StoredSource {
  id: string;
  displayName: string;
  version: string;
  state: SourceState;
  lastScanAt: string | null;
}

interface ScanCounts {
  parsed: number;
  failed: number;
}

const migration = `
  CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS source (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    state TEXT NOT NULL,
    last_scan_at TEXT
  );
  CREATE TABLE IF NOT EXISTS authorization_grant (
    source_id TEXT PRIMARY KEY REFERENCES source(id),
    root TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS scan_run (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id),
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    parsed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS event (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id),
    occurred_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    workspace TEXT,
    body TEXT,
    locator_hash TEXT NOT NULL,
    fact_level TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS diagnostic (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id),
    code TEXT NOT NULL,
    severity TEXT NOT NULL,
    safe_message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

export class WorkbenchDatabase {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.#db = new DatabaseSync(path);
    this.#db.exec(migration);
    this.#db.prepare('INSERT OR IGNORE INTO schema_migration(version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
  }

  close(): void {
    this.#db.close();
  }

  upsertSource(source: Pick<StoredSource, 'id' | 'displayName' | 'version'>): void {
    this.#db.prepare(`
      INSERT INTO source(id, display_name, adapter_version, state)
      VALUES (?, ?, ?, 'awaiting_authorization')
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, adapter_version = excluded.adapter_version
    `).run(source.id, source.displayName, source.version);
  }

  listSources(): StoredSource[] {
    return this.#db.prepare('SELECT id, display_name AS displayName, adapter_version AS version, state, last_scan_at AS lastScanAt FROM source ORDER BY display_name').all() as unknown as StoredSource[];
  }

  setSourceState(sourceId: string, state: SourceState): void {
    this.#db.prepare('UPDATE source SET state = ? WHERE id = ?').run(state, sourceId);
  }

  saveGrant(sourceId: string, root: string, scope: AuthorizationGrant['scope']): AuthorizationGrant {
    const grantedAt = new Date().toISOString();
    this.#db.prepare(`
      INSERT INTO authorization_grant(source_id, root, scope, granted_at, revoked_at, last_used_at)
      VALUES (?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(source_id) DO UPDATE SET root = excluded.root, scope = excluded.scope, granted_at = excluded.granted_at, revoked_at = NULL
    `).run(sourceId, root, scope, grantedAt);
    this.setSourceState(sourceId, 'ready');
    return this.getGrant(sourceId)!;
  }

  getGrant(sourceId: string): AuthorizationGrant | null {
    const row = this.#db.prepare(`
      SELECT source_id AS sourceId, root, scope, granted_at AS grantedAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt
      FROM authorization_grant WHERE source_id = ?
    `).get(sourceId) as AuthorizationGrant | undefined;
    return row ?? null;
  }

  revokeGrant(sourceId: string): void {
    this.#db.prepare('UPDATE authorization_grant SET revoked_at = ? WHERE source_id = ?').run(new Date().toISOString(), sourceId);
    this.setSourceState(sourceId, 'awaiting_authorization');
  }

  touchGrant(sourceId: string): void {
    this.#db.prepare('UPDATE authorization_grant SET last_used_at = ? WHERE source_id = ?').run(new Date().toISOString(), sourceId);
  }

  beginScan(sourceId: string): ScanSummary {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.#db.prepare('INSERT INTO scan_run(id, source_id, status, started_at) VALUES (?, ?, ?, ?)').run(id, sourceId, 'blocked', startedAt);
    this.setSourceState(sourceId, 'scanning');
    return { id, sourceId, status: 'blocked', startedAt, endedAt: null, parsed: 0, failed: 0 };
  }

  finishScan(summary: ScanSummary): void {
    this.#db.prepare(`
      UPDATE scan_run SET status = ?, ended_at = ?, parsed_count = ?, failed_count = ? WHERE id = ?
    `).run(summary.status, summary.endedAt, summary.parsed, summary.failed, summary.id);
    this.#db.prepare('UPDATE source SET state = ?, last_scan_at = ? WHERE id = ?').run(
      summary.status === 'success' ? 'ready' : summary.status === 'partial' ? 'partial' : 'blocked',
      summary.endedAt,
      summary.sourceId,
    );
  }

  addEvent(record: NormalizedRecord): void {
    const locatorHash = createHash('sha256').update(record.locator).digest('hex');
    this.#db.prepare(`
      INSERT INTO event(id, source_id, occurred_at, event_type, title, workspace, body, locator_hash, fact_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET occurred_at = excluded.occurred_at, event_type = excluded.event_type, title = excluded.title, workspace = excluded.workspace, body = excluded.body, locator_hash = excluded.locator_hash, fact_level = excluded.fact_level
    `).run(record.id, record.sourceId, record.occurredAt, record.type, record.title, record.workspace, record.body, locatorHash, record.factLevel);
  }

  addDiagnostic(diagnostic: Diagnostic): void {
    this.#db.prepare('INSERT INTO diagnostic(id, source_id, code, severity, safe_message, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), diagnostic.sourceId, diagnostic.code, diagnostic.severity, diagnostic.safeMessage, diagnostic.createdAt,
    );
  }

  deleteSourceIndex(sourceId: string): void {
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare('DELETE FROM event WHERE source_id = ?').run(sourceId);
      this.#db.prepare('DELETE FROM diagnostic WHERE source_id = ?').run(sourceId);
      this.#db.prepare('DELETE FROM scan_run WHERE source_id = ?').run(sourceId);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  listEvents(limit = 100): Array<Record<string, unknown>> {
    return this.#db.prepare(`
      SELECT id, source_id AS sourceId, occurred_at AS occurredAt, event_type AS type, title, workspace, fact_level AS factLevel
      FROM event ORDER BY occurred_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  }

  listDiagnostics(sourceId?: string): Array<Record<string, unknown>> {
    return sourceId
      ? this.#db.prepare('SELECT source_id AS sourceId, code, severity, safe_message AS safeMessage, created_at AS createdAt FROM diagnostic WHERE source_id = ? ORDER BY created_at DESC').all(sourceId) as Array<Record<string, unknown>>
      : this.#db.prepare('SELECT source_id AS sourceId, code, severity, safe_message AS safeMessage, created_at AS createdAt FROM diagnostic ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  }

  listScanRuns(): ScanSummary[] {
    return this.#db.prepare(`
      SELECT id, source_id AS sourceId, status, started_at AS startedAt, ended_at AS endedAt, parsed_count AS parsed, failed_count AS failed
      FROM scan_run ORDER BY started_at DESC
    `).all() as unknown as ScanSummary[];
  }

  dashboard(): Record<string, unknown> {
    const count = this.#db.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number };
    const projects = this.#db.prepare('SELECT COUNT(DISTINCT workspace) AS count FROM event WHERE workspace IS NOT NULL').get() as { count: number };
    return { eventCount: count.count, projectCount: projects.count, dataState: count.count === 0 ? 'empty' : 'ready' };
  }

  quality(): Record<string, unknown> {
    const row = this.#db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial, SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
      FROM scan_run
    `).get() as { total: number; partial: number | null; blocked: number | null };
    return { scans: row.total, partial: row.partial ?? 0, blocked: row.blocked ?? 0, diagnostics: this.listDiagnostics() };
  }
}
