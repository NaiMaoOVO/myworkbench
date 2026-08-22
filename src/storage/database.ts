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
  CREATE TABLE IF NOT EXISTS app_setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scan_file_state (
    source_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    locator_hash TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (source_id, file_key)
  );
  CREATE INDEX IF NOT EXISTS idx_event_occurred_at ON event(occurred_at);
  CREATE INDEX IF NOT EXISTS idx_event_source ON event(source_id);
  CREATE INDEX IF NOT EXISTS idx_event_source_locator ON event(source_id, locator_hash);
  CREATE INDEX IF NOT EXISTS idx_event_workspace ON event(workspace);
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

  transaction(fn: () => void): void {
    this.#db.exec('BEGIN');
    try {
      fn();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Bulk insert for tooling and performance verification; same upsert semantics as addEvent. */
  insertEventsBulk(records: NormalizedRecord[]): void {
    const statement = this.#db.prepare(`
      INSERT INTO event(id, source_id, occurred_at, event_type, title, workspace, body, locator_hash, fact_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        occurred_at = excluded.occurred_at, event_type = excluded.event_type, title = excluded.title,
        workspace = excluded.workspace, body = excluded.body, fact_level = excluded.fact_level
    `);
    for (const record of records) {
      const locatorHash = createHash('sha256').update(record.locator).digest('hex');
      statement.run(record.id, record.sourceId, record.occurredAt, record.type, record.title, record.workspace, record.body, locatorHash, record.factLevel);
    }
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
      this.#db.prepare('DELETE FROM scan_file_state WHERE source_id = ?').run(sourceId);
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

  getFileState(sourceId: string, fileKey: string): { mtimeMs: number; size: number } | null {
    const row = this.#db.prepare('SELECT mtime_ms AS mtimeMs, size FROM scan_file_state WHERE source_id = ? AND file_key = ?').get(sourceId, fileKey) as { mtimeMs: number; size: number } | undefined;
    return row ?? null;
  }

  recordFileState(sourceId: string, fileKey: string, locatorHash: string, mtimeMs: number, size: number): void {
    this.#db.prepare(`
      INSERT INTO scan_file_state(source_id, file_key, locator_hash, mtime_ms, size)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, file_key) DO UPDATE SET locator_hash = excluded.locator_hash, mtime_ms = excluded.mtime_ms, size = excluded.size
    `).run(sourceId, fileKey, locatorHash, mtimeMs, size);
  }

  deleteEventsForLocatorHash(sourceId: string, locatorHash: string): void {
    this.#db.prepare('DELETE FROM event WHERE source_id = ? AND locator_hash = ?').run(sourceId, locatorHash);
  }

  clearFileStates(sourceId: string): void {
    this.#db.prepare('DELETE FROM scan_file_state WHERE source_id = ?').run(sourceId);
  }

  forgetFileStatesExcept(sourceId: string, keepKeys: string[]): void {
    const rows = this.#db.prepare('SELECT file_key AS fileKey, locator_hash AS locatorHash FROM scan_file_state WHERE source_id = ?').all(sourceId) as Array<{ fileKey: string; locatorHash: string }>;
    const keep = new Set(keepKeys);
    for (const row of rows) {
      if (keep.has(row.fileKey)) continue;
      this.deleteEventsForLocatorHash(sourceId, row.locatorHash);
      this.#db.prepare('DELETE FROM scan_file_state WHERE source_id = ? AND file_key = ?').run(sourceId, row.fileKey);
    }
  }

  getEventBody(id: string): string | null {
    const row = this.#db.prepare('SELECT body FROM event WHERE id = ?').get(id) as { body: string | null } | undefined;
    return row?.body ?? null;
  }

  getSettings(): Record<string, string> {
    const rows = this.#db.prepare('SELECT key, value FROM app_setting').all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  setSetting(key: string, value: string): void {
    this.#db.prepare('INSERT INTO app_setting(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  dashboard(): Record<string, unknown> {
    // 单遍 SQL 聚合（利用 occurred_at 索引），避免把全部事件拉到 JS 侧迭代。
    const now = Date.now();
    const d14 = new Date(now - 14 * 86400000).toISOString();
    const d30 = new Date(now - 30 * 86400000).toISOString();
    const d90 = new Date(now - 90 * 86400000).toISOString();
    const row = this.#db.prepare(
      'SELECT COUNT(*) AS eventCount, COUNT(DISTINCT CASE WHEN workspace IS NOT NULL THEN workspace END) AS projectCount, ' +
      'SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS events30, ' +
      'SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS events90, ' +
      "SUM(CASE WHEN occurred_at >= ? AND source_id = 'git' THEN 1 ELSE 0 END) AS commits30, " +
      "SUM(CASE WHEN occurred_at >= ? AND source_id IN ('obsidian', 'exports-compat') THEN 1 ELSE 0 END) AS contentActivity30, " +
      "SUM(CASE WHEN occurred_at >= ? AND source_id NOT IN ('git', 'obsidian', 'exports-compat') THEN 1 ELSE 0 END) AS sessions30, " +
      'COUNT(DISTINCT CASE WHEN occurred_at >= ? AND workspace IS NOT NULL THEN workspace END) AS activeProjects14d FROM event'
    ).get(d30, d90, d30, d30, d14) as Record<string, number | null>;
    const num = (value: number | null | undefined): number => value ?? 0;
    const sessions30 = num(row.sessions30);
    // 工作分钟为估算口径：每条 AI 会话事件计 5 分钟；UI 必须随数字展示口径说明。
    const workMinutes30 = sessions30 * 5;
    return {
      eventCount: num(row.eventCount),
      projectCount: num(row.projectCount),
      dataState: num(row.eventCount) === 0 ? 'empty' : 'ready',
      events30: num(row.events30),
      events90: num(row.events90),
      commits30: num(row.commits30),
      contentActivity30: num(row.contentActivity30),
      activeProjects14d: num(row.activeProjects14d),
      workMinutes30,
      groups30: {
        delivery: num(row.commits30),
        creation: num(row.contentActivity30),
        sessions: sessions30,
      },
    };
  }

  quality(): Record<string, unknown> {
    const row = this.#db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial, SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
      FROM scan_run
    `).get() as { total: number; partial: number | null; blocked: number | null };
    return { scans: row.total, partial: row.partial ?? 0, blocked: row.blocked ?? 0, diagnostics: this.listDiagnostics() };
  }
}
