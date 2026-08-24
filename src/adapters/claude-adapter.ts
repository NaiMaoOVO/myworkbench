import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdapterHealth, AdapterScanContext, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';
import { scanJsonlDirectory } from './jsonl-incremental.js';

const sourceId = 'claude';

const noisyTypes = new Set(['file-history-snapshot', 'permission-mode', 'last-prompt', 'attachment', 'summary']);

function optionalString(value: unknown, ...fields: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof row[field] === 'string' && (row[field] as string).trim() !== '') return row[field] as string;
  }
  return undefined;
}

/** Claude Code 原生会话行：user/assistant 的 message.content 为字符串或分块数组。 */
function flattenContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') return [b.text];
      if (b.type === 'tool_use' && typeof b.name === 'string') return ['[tool_use ' + b.name + ']'];
      if (b.type === 'tool_result') return ['[tool_result]'];
      if (typeof b.type === 'string') return ['[' + b.type + ']'];
      return [];
    });
    const joined = parts.join('\n');
    return joined || null;
  }
  return null;
}

function mapRow(value: unknown, locator: string, includeBody: boolean): RawRecord | null {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const type = optionalString(row, 'type');
  if (!type) throw new Error('Record needs a type.');
  if (noisyTypes.has(type)) return null; // 工具簿记行：静默跳过

  const time = optionalString(row, 'timestamp');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record timestamp must be ISO-8601 compatible.');
  const id = optionalString(row, 'uuid', 'messageId', 'leafUuid') ?? optionalString(row, 'sessionId');
  if (!id) throw new Error('Record needs a uuid.');
  const workspace = optionalString(row, 'cwd');

  const message = row.message && typeof row.message === 'object'
    ? (row.message as { content?: unknown })
    : undefined;
  const bodyText = includeBody ? (flattenContent(message?.content) ?? undefined) : undefined;

  const cwdName = workspace?.split('/').filter(Boolean).at(-1);

  return {
    id,
    time,
    type,
    title: `Claude ${type}${cwdName ? ` · ${cwdName}` : ''}`,
    workspace: workspace ?? undefined,
    body: bodyText,
    locator,
  };
}

function malformedDiagnostic(locator: string, line: number): Diagnostic {
  return {
    sourceId,
    code: 'CLAUDE_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `A Claude record in ${locator} at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

async function sessionFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = join(dir, entry.name);
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.name.endsWith('.jsonl')) out.push(child);
    }
  };
  await walk(root, 0);
  return out.sort();
}

export class ClaudeAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'Claude',
      version: '2.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    // 候选路径属于版本化发现规则（来源中心可见）；适配器本身不静默读取。
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    void root;
    let estimatedRecords = 0;
    const times: string[] = [];
    for await (const item of this.scan({ ...grant, scope: 'metadata' })) {
      if (item.kind === 'record') {
        estimatedRecords += 1;
        times.push(item.value.time);
      }
    }
    times.sort();
    return {
      estimatedRecords,
      earliest: times.at(0) ?? null,
      latest: times.at(-1) ?? null,
      excluded: ['Claude 会话正文需要单独的正文授权。'],
    };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string, context?: AdapterScanContext): AsyncIterable<ScanRecord> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    yield* scanJsonlDirectory({
      root,
      sourceId,
      includeBody: grant.scope === 'metadata_and_body',
      select: () => true,
      recursive: true,
      mapRow,
      diagnosticCode: 'CLAUDE_RECORD_INVALID',
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
    // v2 对齐 Claude Code 原生 projects 目录布局。
  }
}
