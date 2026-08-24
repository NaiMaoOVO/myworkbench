import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AdapterHealth, AdapterScanContext, AuthorizationGrant, CandidateLocation, Diagnostic, NormalizedRecord, PlatformContext, RawRecord, ScanPreview, ScanRecord, SourceAdapter, SourceManifest } from '../core/types.js';
import { assertPathWithinGrant } from '../platform/path-policy.js';
import { scanJsonlDirectory } from './jsonl-incremental.js';

const sourceId = 'codex';

function optionalString(value: unknown, ...fields: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  for (const field of fields) {
    if (typeof row[field] === 'string' && (row[field] as string).trim() !== '') return row[field] as string;
  }
  return undefined;
}

function flattenContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') return [b.text];
      return [];
    });
    return parts.join('\n') || null;
  }
  return null;
}

/**
 * Codex CLI rollout 行（真实结构）：
 * - session_meta: payload{session_id, cwd, cli_version, ...}
 * - response_item: payload{type:'message'|'reasoning'|'function_call'|..., role, content[], name, output}
 * - event_msg/task_complete: payload{duration_ms, last_agent_message}
 */
function mapRow(value: unknown, locator: string, includeBody: boolean): RawRecord | null {
  if (!value || typeof value !== 'object') throw new Error('Record must be an object.');
  const row = value as Record<string, unknown>;
  const rowType = optionalString(row, 'type') ?? 'unknown';
  // 工具自身的状态/遥测行不产生事件。
  if (['world_state', 'inter_agent_communication_metadata'].includes(rowType)) return null;
  if (rowType === 'event_msg' && optionalString((row.payload ?? {}) as never, 'type') === 'token_count') return null;

  const time = optionalString(row, 'timestamp') ?? optionalString(row.payload, 'timestamp');
  if (!time || Number.isNaN(Date.parse(time))) throw new Error('Record timestamp must be ISO-8601 compatible.');

  const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
  const subType = optionalString(payload, 'type');

  let id = optionalString(payload, 'id');
  if (!id) {
    id = 'hash-' + createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  }

  const workspace = optionalString(payload, 'cwd') ?? undefined;
  const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null;

  let type = rowType;
  let title = `Codex ${rowType}`;
  let bodyText: string | null = null;

  if (rowType === 'session_meta') {
    title = `Codex 会话 · ${optionalString(payload, 'cwd')?.split('/').filter(Boolean).at(-1) ?? '未知项目'}`;
    type = 'session';
  } else if (rowType === 'response_item' || rowType === 'event_msg') {
    const sub = optionalString(payload, 'type');
    if (sub === 'message' || sub === 'agent_message') {
      type = `message:${optionalString(payload, 'role') ?? 'assistant'}`;
      title = `Codex ${optionalString(payload, 'role') ?? sub} 消息`;
      bodyText = includeBody ? flattenContent(payload.content) : null;
    } else if (sub === 'function_call' || sub === 'custom_tool_call') {
      const toolName = optionalString(payload, 'name') ?? 'tool';
      type = `tool_call:${toolName}`;
      title = `Codex 工具调用 · ${toolName}`;
      bodyText = includeBody && typeof payload.arguments === 'string' ? payload.arguments.slice(0, 4000) : null;
    } else if (sub === 'function_call_output' || sub === 'custom_tool_call_output') {
      type = 'tool_output';
      title = 'Codex 工具输出';
      bodyText = includeBody && typeof payload.output === 'string' ? payload.output.slice(0, 4000) : null;
    } else if (sub === 'reasoning') {
      type = 'reasoning';
      title = 'Codex 推理（加密摘要）';
    } else if (sub === 'task_started' || sub === 'task_complete') {
      type = sub;
      title = sub === 'task_complete' ? 'Codex 任务完成' : 'Codex 任务开始';
      if (sub === 'task_complete' && includeBody && typeof payload.last_agent_message === 'string') {
        bodyText = payload.last_agent_message;
      }
    } else {
      title = `Codex ${rowType}`;
    }
  }

  const result: RawRecord = {
    id,
    time,
    type,
    title,
    workspace,
    body: bodyText ?? undefined,
    locator,
  };
  if (durationMs !== null) result.durationMs = durationMs;
  return result;
}

function malformedDiagnostic(locator: string, line: number): Diagnostic {
  return {
    sourceId,
    code: 'CODEX_RECORD_INVALID',
    severity: 'warning',
    safeMessage: `A Codex record in ${locator} at line ${line} could not be parsed.`,
    createdAt: new Date().toISOString(),
  };
}

async function rolloutFiles(root: string): Promise<string[]> {
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

export class CodexAdapter implements SourceAdapter {
  manifest(): SourceManifest {
    return {
      id: sourceId,
      displayName: 'Codex',
      version: '2.0.0',
      supportedPlatforms: ['darwin', 'win32', 'linux'],
      supportsBodies: true,
    };
  }

  async discover(_platform: PlatformContext): Promise<CandidateLocation[]> {
    return [];
  }

  async preview(grant: AuthorizationGrant): Promise<ScanPreview> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    const files = await rolloutFiles(root);
    let estimatedRecords = 0;
    const times: string[] = [];
    for (const file of files) {
      void file;
      for await (const item of this.scan({ ...grant, scope: 'metadata' })) {
        if (item.kind === 'record') {
          estimatedRecords += 1;
          times.push(item.value.time);
        }
      }
      break;
    }
    times.sort();
    return {
      estimatedRecords,
      earliest: times.at(0) ?? null,
      latest: times.at(-1) ?? null,
      excluded: ['Codex 会话正文需要单独的正文授权。'],
    };
  }

  async *scan(grant: AuthorizationGrant, _cursor?: string, context?: AdapterScanContext): AsyncIterable<ScanRecord> {
    const root = await assertPathWithinGrant(grant.root, grant.root);
    const includeBody = grant.scope === 'metadata_and_body';
    yield* scanJsonlDirectory({
      root,
      sourceId,
      includeBody,
      recursive: true,
      select: (fileName) => fileName.endsWith('.jsonl'),
      mapRow,
      diagnosticCode: 'CODEX_RECORD_INVALID',
      context,
    });
  }

  normalize(raw: RawRecord): NormalizedRecord {
    const normalized: NormalizedRecord = {
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
    if (raw.durationMs != null) normalized.durationMs = raw.durationMs;
    return normalized;
  }

  redact(record: NormalizedRecord, scope: AuthorizationGrant['scope']): NormalizedRecord {
    return { ...record, body: scope === 'metadata_and_body' ? record.body : null };
  }

  async health(): Promise<AdapterHealth> {
    return { state: 'ready' };
  }

  async migrate(_fromVersion: string): Promise<void> {
    // v2 对齐 Codex rollout 真实目录与 payload 结构。
  }
}
