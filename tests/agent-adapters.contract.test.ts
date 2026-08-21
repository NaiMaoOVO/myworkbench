import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../src/adapters/claude-adapter.js';
import { CodexAdapter } from '../src/adapters/codex-adapter.js';
import { GeminiAdapter } from '../src/adapters/gemini-adapter.js';
import { HermesAdapter } from '../src/adapters/hermes-adapter.js';
import { IFlowAdapter } from '../src/adapters/iflow-adapter.js';
import { KimiCodeAdapter } from '../src/adapters/kimi-code-adapter.js';
import { OpenClawAdapter } from '../src/adapters/openclaw-adapter.js';
import { ZCodeAdapter } from '../src/adapters/zcode-adapter.js';
import type { AuthorizationGrant, SourceAdapter } from '../src/core/types.js';

type AgentFixture = 'codex' | 'claude' | 'iflow' | 'zcode' | 'kimi-code' | 'gemini' | 'hermes' | 'openclaw';

async function fixtureGrant(sourceId: AgentFixture, scope: AuthorizationGrant['scope'] = 'metadata'): Promise<AuthorizationGrant> {
  const root = await mkdtemp(join(tmpdir(), `mw-${sourceId}-fixture-`));
  await cp(`fixtures/anonymous/agents/${sourceId}.jsonl`, join(root, `${sourceId}.jsonl`));
  return { sourceId, root, scope, grantedAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null };
}

function agentAdapterCases(): Array<{ sourceId: AgentFixture; adapter: SourceAdapter }> {
  return [
    { sourceId: 'codex', adapter: new CodexAdapter() },
    { sourceId: 'claude', adapter: new ClaudeAdapter() },
    { sourceId: 'iflow', adapter: new IFlowAdapter() },
    { sourceId: 'zcode', adapter: new ZCodeAdapter() },
    { sourceId: 'kimi-code', adapter: new KimiCodeAdapter() },
    { sourceId: 'gemini', adapter: new GeminiAdapter() },
    { sourceId: 'hermes', adapter: new HermesAdapter() },
    { sourceId: 'openclaw', adapter: new OpenClawAdapter() },
  ];
}

describe('agent adapter contract', () => {
  it.each(agentAdapterCases())('$sourceId does not discover or read an unapproved default location', async ({ adapter, sourceId }) => {
    expect(adapter.manifest()).toMatchObject({ id: sourceId, supportsBodies: true, version: '1.0.0' });
    expect(await adapter.discover({ platform: process.platform })).toEqual([]);
    expect(await adapter.health()).toEqual({ state: 'ready' });
  });

  it.each(agentAdapterCases())('$sourceId previews valid records and isolates one malformed JSONL line', async ({ adapter, sourceId }) => {
    const grant = await fixtureGrant(sourceId);
    await expect(adapter.preview(grant)).resolves.toMatchObject({ estimatedRecords: 2 });

    const results = [];
    for await (const item of adapter.scan(grant)) results.push(item);

    expect(results.filter((item) => item.kind === 'record')).toHaveLength(2);
    expect(results.filter((item) => item.kind === 'diagnostic')).toHaveLength(1);
  });

  it.each(agentAdapterCases())('$sourceId excludes bodies during metadata-only scans', async ({ adapter, sourceId }) => {
    const metadataGrant = await fixtureGrant(sourceId);
    const results = [];
    for await (const item of adapter.scan(metadataGrant)) results.push(item);
    const first = results.find((item) => item.kind === 'record');
    if (!first || first.kind !== 'record') throw new Error('fixture failed');

    expect(first.value.body).toBeUndefined();
    expect(adapter.redact(adapter.normalize(first.value), 'metadata').body).toBeNull();
  });

  it.each(agentAdapterCases())('$sourceId only exposes a body after a body grant', async ({ adapter, sourceId }) => {
    const bodyGrant = await fixtureGrant(sourceId, 'metadata_and_body');
    const results = [];
    for await (const item of adapter.scan(bodyGrant)) results.push(item);
    const first = results.find((item) => item.kind === 'record');
    if (!first || first.kind !== 'record') throw new Error('fixture failed');

    expect(first.value.body).toBeTruthy();
    expect(adapter.redact(adapter.normalize(first.value), 'metadata_and_body').body).toBeTruthy();
  });

  it.each(agentAdapterCases())('$sourceId does not leak corrupt JSONL content in diagnostics', async ({ adapter, sourceId }) => {
    const grant = await fixtureGrant(sourceId);
    const results = [];
    for await (const item of adapter.scan(grant)) results.push(item);
    const diagnostic = results.find((item) => item.kind === 'diagnostic');

    expect(diagnostic).toMatchObject({
      kind: 'diagnostic',
      value: { safeMessage: expect.not.stringContaining('intentionally malformed') },
    });
  });
});
