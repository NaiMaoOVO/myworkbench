import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest, AdapterScanContext } from '../core/types.js';
import { scanJsonlDirectory } from './jsonl-incremental.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'iflow.jsonl';
const sourceId = 'iflow';

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

// iFlow CLI is a Gemini-CLI derivative; releases have shipped both "timestamp"
// and "created_at" column names, so the parser tolerates either spelling.
function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = optionalString(row, 'timestamp', 'created_at');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record time must be ISO-8601 compatible.');
  const workspace = optionalString(row, 'workspace', 'cwd');

  return {
    id: requiredString(row, 'sessionId'),
    time,
    type: optionalString(row, 'recordType', 'type') ?? 'session',
    title: optionalString(row, 'title', 'summary') ?? `iFlow session ${requiredString(row, 'sessionId')}`,
    workspace,
    body: includeBody && typeof row.content === 'string' ? row.content : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'IFLOW_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `An iFlow record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class IFlowAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'iFlow',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    // iFlow's data directory is user-configurable, so discovery cannot guess a
    // trustworthy default; users grant the exact folder instead.
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
      excluded: ['iFlow session bodies require a separate per-source body grant.'],
    };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string, context?: AdapterScanContext): AsyncIterable<ScanRecord> {
    await assertPathWithinGrant(grant.root, join(grant.root, dataFileName));
    const includeBody = grant.scope === 'metadata_and_body';
    yield* scanJsonlDirectory({
      root: grant.root,
      sourceId,
      includeBody,
      select: (fileName) => fileName === dataFileName,
      mapRow: asRawRecord,
      diagnosticCode: "IFLOW_RECORD_INVALID",
      context,
    });
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
