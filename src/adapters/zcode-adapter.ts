import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterHealth, AdapterScanContext, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { scanJsonlDirectory } from './jsonl-incremental.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';

const sourceId = 'zcode';

function optionalString(value: unknown, ...fields: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof row[field] === 'string' && (row[field] as string).trim() !== '') return row[field] as string;
  }
  return undefined;
}

// Real ZCode CLI rollout logs: one JSONL file per session under a rollout
// directory, one row per model I/O exchange. Rows carry startedAt/completedAt,
// a requestId unique per row, a nested model descriptor, and the exchange
// bodies inside request/response objects. Project paths are not part of this
// log format, so workspace stays empty rather than being guessed.
function asRawRecord(value: unknown, locator: string, includeBody: boolean): RawRecord {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const time = optionalString(row, 'startedAt', 'completedAt', 'timestamp');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record time must be ISO-8601 compatible.');
  const id = optionalString(row, 'requestId', 'turnId', 'id');
  if (!id) throw new Error('Record needs a requestId.');
  const model = (row.model && typeof row.model === 'object' ? row.model : undefined) as Record<string, unknown> | undefined;
  const modelId = optionalString(model, 'modelId');
  const type = optionalString(row, 'type') ?? 'model_io';
  const response = row.response && typeof row.response === 'object' ? row.response : undefined;
  const bodyText = optionalString(response, 'text');

  return {
    id,
    time,
    type,
    title: `ZCode ${type}${modelId ? ` · ${modelId}` : ''}`,
    workspace: undefined,
    body: includeBody && bodyText ? bodyText : undefined,
    locator,
  };
}

async function rolloutFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  return entries.filter((name) => name.endsWith('.jsonl')).sort();
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
    // Rollout directories move between ZCode versions; discovery only ever
    // offers hints, so users grant the exact folder.
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    const files = await rolloutFiles(root);
    const times: string[] = [];
    let estimatedRecords = 0;
    for (const name of files) {
      const file = join(root, name);
      await stat(file);
      const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
      for await (const line of reader) {
        if (!line.trim()) continue;
        try {
          const record = asRawRecord(JSON.parse(line), name, false);
          estimatedRecords += 1;
          times.push(record.time);
        } catch {
          // Preview counts only parseable metadata; scan emits a safe diagnostic for malformed lines.
        }
      }
    }

    times.sort();
    return {
      estimatedRecords,
      earliest: times.at(0) ?? null,
      latest: times.at(-1) ?? null,
      excluded: ['ZCode model I/O bodies require a separate per-source body grant.'],
    };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string, context?: AdapterScanContext): AsyncIterable<ScanRecord> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    const includeBody = grant.scope === 'metadata_and_body';
    yield* scanJsonlDirectory({
      root,
      sourceId,
      includeBody,
      select: (fileName) => fileName.endsWith('.jsonl'),
      mapRow: asRawRecord,
      diagnosticCode: 'ZCODE_RECORD_INVALID',
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
    // v1.1 reads the real multi-file rollout layout; no persisted state.
  }
}
