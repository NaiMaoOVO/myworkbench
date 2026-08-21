import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const dataFileName = 'openclaw.jsonl';
const sourceId = 'openclaw';

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

// OpenClaw logs interleave conversation turns and tool events; tool records keep
// their tool name as part of the record type so evidence lists stay readable.
function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = optionalString(row, 'timestamp', 'created_at');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record time must be ISO-8601 compatible.');
  const eventType = optionalString(row, 'eventType', 'type') ?? 'session';
  const toolName = optionalString(row, 'tool', 'toolName');
  // Every line needs its own stable id; a bare sessionId would make sibling
  // records overwrite each other in the derived index.
  const recordId = optionalString(row, 'eventId', 'id');
  if (!recordId) throw new Error('Record needs an eventId or id.');

  return {
    id: toolName ? `${recordId}:tool` : recordId,
    time,
    type: toolName ? `${eventType}:${toolName}` : eventType,
    title: optionalString(row, 'title', 'summary') ?? `OpenClaw ${eventType}`,
    workspace: optionalString(row, 'cwd', 'workspace'),
    body: includeBody && typeof row.content === 'string' ? row.content : undefined,
    locator,
  };
}

function malformedDiagnostic(line: number): Diagnostic {
  return {
    sourceId,
    code: 'OPENCLAW_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `An OpenClaw record at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

export class OpenClawAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'OpenClaw',
      version: '1.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    // Discovery failure falls back to manual location per the PRD; users
  // therefore grant the folder explicitly.
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
      excluded: ['OpenClaw session bodies require a separate per-source body grant.'],
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
