import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExportsCompatibilityAdapter } from '../src/adapters/exports-adapter.js';
import type { AuthorizationGrant } from '../src/core/types.js';

async function fixtureGrant(): Promise<AuthorizationGrant> {
  const root = await mkdtemp(join(tmpdir(), 'mw-exports-fixture-'));
  await cp('fixtures/anonymous/exports/exports.jsonl', join(root, 'exports.jsonl'));
  return { sourceId: 'exports-compat', root, scope: 'metadata', grantedAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null };
}

describe('exports compatibility adapter contract', () => {
  it('declares a privacy-preserving metadata-only import adapter', async () => {
    const adapter = new ExportsCompatibilityAdapter();
    expect(adapter.manifest()).toMatchObject({ id: 'exports-compat', supportsBodies: false, version: '1.0.0' });
    expect(await adapter.health()).toEqual({ state: 'ready' });
    expect(await adapter.discover({ platform: process.platform })).toEqual([]);
  });

  it('previews and scans valid records while isolating a malformed record', async () => {
    const adapter = new ExportsCompatibilityAdapter();
    const grant = await fixtureGrant();
    await expect(adapter.preview(grant)).resolves.toMatchObject({ estimatedRecords: 2 });
    const results = [];
    for await (const item of adapter.scan(grant)) results.push(item);
    expect(results.filter((item) => item.kind === 'record')).toHaveLength(2);
    expect(results.filter((item) => item.kind === 'diagnostic')).toHaveLength(1);
  });

  it('does not retain a body in metadata-only records', async () => {
    const adapter = new ExportsCompatibilityAdapter();
    const grant = await fixtureGrant();
    const scanResults = [];
    for await (const item of adapter.scan(grant)) scanResults.push(item);
    const first = scanResults.find((item) => item.kind === 'record');
    if (!first || first.kind !== 'record') throw new Error('fixture failed');
    expect(adapter.redact(adapter.normalize(first.value), 'metadata').body).toBeNull();
  });

  it('reports corrupt fixture data without exposing its content in diagnostics', async () => {
    const grant = await fixtureGrant();
    const path = join(grant.root, 'exports.jsonl');
    await writeFile(path, `${await readFile(path, 'utf8')}\n{"id":"x"}`);
    const adapter = new ExportsCompatibilityAdapter();
    const results = [];
    for await (const item of adapter.scan(grant)) results.push(item);
    const diagnostic = results.find((item) => item.kind === 'diagnostic');
    expect(diagnostic).toMatchObject({ kind: 'diagnostic', value: { safeMessage: expect.not.stringContaining('{"id"') } });
  });
});
