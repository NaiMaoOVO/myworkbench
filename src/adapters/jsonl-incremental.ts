import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterScanContext, Diagnostic, RawRecord, ScanRecord } from '../core/types.js';

export interface JsonlScanOptions {
  root: string;
  sourceId: string;
  includeBody: boolean;
  /** Either an exact file name (single-log tools) or a matcher for rollout layouts. */
  select: (name: string) => boolean;
  mapRow: (value: unknown, locator: string, includeBody: boolean) => RawRecord;
  diagnosticCode: string;
  context?: AdapterScanContext;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Incremental JSONL directory scan shared by the agent-family adapters.
 *
 * Unchanged files (same mtime and size) are skipped entirely; changed files
 * have their previous events removed before re-insertion so idempotency holds
 * even when ids repeat inside a file. Files that disappear from the granted
* directory have both their state and derived events pruned.
 */
export async function* scanJsonlDirectory(options: JsonlScanOptions): AsyncGenerator<ScanRecord> {
  const { root, sourceId, includeBody, select, mapRow, diagnosticCode, context } = options;
  const names = (await readdir(root)).filter((name) => name.endsWith('.jsonl') && select(name)).sort();
  const keptKeys: string[] = [];

  for (const name of names) {
    const file = join(root, name);
    const info = await stat(file);
    keptKeys.push(name);

    const previous = context?.previousFileState(name) ?? null;
    if (previous && previous.mtimeMs === Math.floor(info.mtimeMs) && previous.size === info.size) continue;

    const locatorHash = hashKey(name);
    context?.deleteRecordsForLocator(sourceId, locatorHash);

    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const raw = mapRow(JSON.parse(line), name, includeBody);
        yield { kind: 'record', value: raw };
      } catch {
        const diagnostic: Diagnostic = {
          sourceId,
          code: diagnosticCode,
          severity: 'warning',
          safeMessage: `A record in ${name} at line ${lineNumber} could not be parsed.`,
          createdAt: new Date().toISOString(),
        };
        yield { kind: 'diagnostic', value: diagnostic };
      }
    }

    context?.recordFileState(name, locatorHash, { mtimeMs: Math.floor(info.mtimeMs), size: info.size });
  }

  context?.forgetFileStatesExcept(sourceId, keptKeys);
}
