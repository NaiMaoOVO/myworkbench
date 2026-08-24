import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import type { AdapterScanContext, Diagnostic, RawRecord, ScanRecord } from '../core/types.js';

export interface JsonlScanOptions {
  root: string;
  sourceId: string;
  includeBody: boolean;
  /** Either an exact file name (single-log tools) or a matcher for rollout layouts. */
  select: (name: string) => boolean;
  /** 递归遍历子目录（Claude projects / Codex 日期分层布局）。 */
  recursive?: boolean;
  /** 返回 null 表示该行是工具自身的簿记行，静默跳过且不产生诊断。 */
  mapRow: (value: unknown, locator: string, includeBody: boolean) => RawRecord | null;
  diagnosticCode: string;
  context?: AdapterScanContext;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function listFiles(root: string, recursive: boolean): Promise<string[]> {
  if (!recursive) {
    const entries = await readdir(root);
    return entries.filter((name) => name.endsWith('.jsonl')).sort().map((name) => join(root, name));
  }
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.name.endsWith('.jsonl')) out.push(child);
    }
  };
  await walk(root, 0);
  return out.sort();
}

/**
 * Incremental JSONL scan shared by the agent-family adapters.
 *
 * Unchanged files (same mtime and size) are skipped entirely; changed files
 * have their previous events removed before re-insertion so idempotency holds
 * even when ids repeat inside a file. Files that disappear from the granted
 * directory have both their state and derived events pruned.
 */
export async function* scanJsonlDirectory(options: JsonlScanOptions): AsyncGenerator<ScanRecord> {
  const { root, sourceId, includeBody, select, recursive = false, mapRow, diagnosticCode, context } = options;
  const absoluteFiles = await listFiles(root, recursive);
  const keptKeys: string[] = [];

  for (const file of absoluteFiles) {
    const key = relative(root, file).split('\\').join('/');
    if (!select(key)) continue;
    const info = await stat(file);
    keptKeys.push(key);

    const previous = context?.previousFileState(key) ?? null;
    if (previous && previous.mtimeMs === Math.floor(info.mtimeMs) && previous.size === info.size) continue;

    const locatorHash = hashKey(key);
    context?.deleteRecordsForLocator(sourceId, locatorHash);

    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const mapped = mapRow(JSON.parse(line), key, includeBody);
        if (mapped === null) continue;
        yield { kind: 'record', value: mapped };
      } catch {
        const diagnostic: Diagnostic = {
          sourceId,
          code: diagnosticCode,
          severity: 'warning',
          safeMessage: `A record in ${key} at line ${lineNumber} could not be parsed.`,
          createdAt: new Date().toISOString(),
        };
        yield { kind: 'diagnostic', value: diagnostic };
      }
    }

    context?.recordFileState(key, locatorHash, { mtimeMs: Math.floor(info.mtimeMs), size: info.size });
  }

  context?.forgetFileStatesExcept(sourceId, keptKeys);
}
