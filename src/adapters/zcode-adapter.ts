import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'zcode.jsonl';
const sourceId = 'zcode';

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Record field ${field} is required.`);
  return value;
}

function optionalString(row: Record<string, unknown>, ...fields: string[]): string | undefined {
  for (const field of fields) {
    if (typeof row[field] === 'string' && (row[field] as string).trim() !== '') return row[field] as string;
  }
  return undefined;
}

// ZCode keeps both global session logs and per-project plan records; the
// recordType column distinguishes them so one granted root can hold both.
function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = optionalString(row, 'timestamp', 'created_at');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record time must be ISO-8601 compatible.');
  const id = optionalString(row, 'sessionId', 'planId');
  if (!id) throw new Error('Record needs a sessionId or planId.');
  const workspace = optionalString(row, 'projectPath', 'cwd', 'workspace');

  return {
    id,
    time,
    type: optionalString(row, 'recordType', 'type') ?? 'session',
    title: optionalString(row, 'title', 'summary') ?? `ZCode ${optionalString(row, 'recordType', 'type') ?? 'session'} ${id}`,
    workspace,
    body: includeBody ? optionalString(row, 'content', 'body') : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'ZCODE_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `A ZCode record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class ZCodeAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'ZCode',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    // Global and project record locations differ between ZCode versions, so
    // discovery only ever offers hints; the user grants the exact folder.
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
      excluded: ['ZCode session and plan bodies require a separate per-source body grant.'],
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
