import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'exports.jsonl';
const sourceId = 'exports-compat';

function asRawRecord(value: unknown, locator: string): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  for (const field of ['id', 'time', 'type', 'title'] as const) {
    if (typeof row[field] !== 'string' || row[field].trim() === '') throw new Error(`Record field ${field} is required.`);
  }
  if (Number.isNaN(Date.parse(row.time as string))) throw new Error('Record time must be ISO-8601 compatible.');
  return {
    id: row.id as string,
    time: row.time as string,
    type: row.type as string,
    title: row.title as string,
    workspace: typeof row.workspace === 'string' ? row.workspace : undefined,
    body: typeof row.body === 'string' ? row.body : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'EXPORTS_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `An imported record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class ExportsCompatibilityAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'Exports compatibility import',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: false,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const file = await assertPathWithinGrant(grant.root, join(grant.root, dataFileName));
    await stat(file);
    let estimatedRecords = 0;
    const times: string[] = [];
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) continue;
      try {
        const record = asRawRecord(JSON.parse(line), basename(file));
        estimatedRecords += 1;
        times.push(record.time);
      } catch {
        // Preview reports only parseable estimated records; scan will surface a diagnostic.
      }
    }
    times.sort();
    return { estimatedRecords, earliest: times.at(0) ?? null, latest: times.at(-1) ?? null, excluded: ['Agent and note bodies are not imported by this adapter.'] };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string): AsyncIterable<ScanRecord> {
    const file = await assertPathWithinGrant(grant.root, join(grant.root, dataFileName));
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        yield { kind: 'record', value: asRawRecord(JSON.parse(line), basename(file)) };
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
