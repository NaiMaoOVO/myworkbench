import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'codex.jsonl';
const sourceId = 'codex';

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Record field ${field} is required.`);
  return value;
}

function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = requiredString(row, 'timestamp');
  if (Number.isNaN(Date.parse(time))) throw new Error('Record timestamp must be ISO-8601 compatible.');

  return {
    id: requiredString(row, 'id'),
    time,
    type: requiredString(row, 'event_type'),
    title: requiredString(row, 'summary'),
    workspace: typeof row.cwd === 'string' ? row.cwd : undefined,
    body: includeBody && typeof row.body === 'string' ? row.body : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'CODEX_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `A Codex record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class CodexAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'Codex',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const file = await assertPathWithinGrant(grant.root, join(grant.root, dataFileName));
    await stat(file);
    const times: string[] = [];
    let estimatedRecords = 0;
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });

    for await (const line of reader) {
      if (!line.trim()) continue;
      try {
        const record = asRawRecord(JSON.parse(line), basename(file), false);
        estimatedRecords += 1;
        times.push(record.time);
      } catch {
        // Preview counts only parseable metadata; scan emits a safe diagnostic for malformed lines.
      }
    }

    times.sort();
    return {
      estimatedRecords,
      earliest: times.at(0) ?? null,
      latest: times.at(-1) ?? null,
      excluded: ['Codex session bodies require a separate per-source body grant.'],
    };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string): AsyncIterable<ScanRecord> {
    const file = await assertPathWithinGrant(grant.root, join(grant.root, dataFileName));
    const includeBody = grant.scope === 'metadata_and_body';
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const line of reader) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        yield { kind: 'record', value: asRawRecord(JSON.parse(line), basename(file), includeBody) };
      } catch {
        yield { kind: 'diagnostic', value: malformedDiagnostic(lineNumber) };
      }
    }
  }

  normalize(raw: RawRecord): NormalizedRecord {
    return {
      id: `${sourceId}:${raw.id}`,
      sourceId,
      occurredAt: raw.time,
      type: raw.type,
      title: raw.title,
      workspace: raw.workspace ?? null,
      body: raw.body ?? null,
      locator: raw.locator,
      factLevel: 'observed',
    };
  }

  redact(record: NormalizedRecord, scope: AuthorizationGrant['scope']): NormalizedRecord {
    return { ...record, body: scope === 'metadata_and_body' ? record.body : null };
  }

  async health(): Promise<AdapterHealth> {
    return { state: 'ready' };
  }

  async migrate(_fromVersion: string): Promise<void> {
    // v1 adapter has no persisted adapter-specific state.
  }
}
