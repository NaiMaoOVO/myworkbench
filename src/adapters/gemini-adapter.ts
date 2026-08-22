import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest, AdapterScanContext } from '../core/types.js';
import { scanJsonlDirectory } from './jsonl-incremental.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'gemini.jsonl';
const sourceId = 'gemini';

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

// Gemini CLI changed its timestamp and session column names across releases;
// the version-aware parser accepts the known spellings instead of guessing.
// Model metadata is part of the metadata baseline, so it is surfaced inline in
// the evidence title.
function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = optionalString(row, 'timestamp', 'created_at', 'ts');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record time must be ISO-8601 compatible.');
  const id = optionalString(row, 'sessionId', 'session', 'uuid');
  if (!id) throw new Error('Record needs a sessionId.');
  const model = optionalString(row, 'model');
  const title = optionalString(row, 'title', 'prompt', 'summary') ?? `Gemini session ${id}`;

  return {
    id,
    time,
    type: optionalString(row, 'type', 'role') ?? 'session',
    title: model ? `[${model}] ${title}` : title,
    workspace: optionalString(row, 'cwd', 'workspace'),
    body: includeBody && typeof row.content === 'string' ? row.content : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'GEMINI_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `A Gemini record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class GeminiAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'Gemini',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    // Custom directories are a documented Gemini CLI feature; only the user
    // knows which one holds their sessions.
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
      excluded: ['Gemini session bodies require a separate per-source body grant.'],
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
      diagnosticCode: "GEMINI_RECORD_INVALID",
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
