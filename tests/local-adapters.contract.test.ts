import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitAdapter } from '../src/adapters/git-adapter.js';
import { ObsidianAdapter } from '../src/adapters/obsidian-adapter.js';
import type { AuthorizationGrant } from '../src/core/types.js';

const run = promisify(execFile);

function grant(sourceId: string, root: string, scope: AuthorizationGrant['scope'] = 'metadata'): AuthorizationGrant {
  return { sourceId, root, scope, grantedAt: new Date().toISOString(), revokedAt: null, lastUsedAt: null };
}

describe('Obsidian adapter contract', () => {
  it('collects note metadata without opening note bodies and ignores symlink escapes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mw-obsidian-'));
    const vault = join(parent, 'vault');
    const outside = join(parent, 'outside.md');
    await mkdir(vault);
    await writeFile(join(vault, 'safe.md'), '# Safe\nprivate note body');
    await mkdir(join(vault, '.obsidian'));
    await writeFile(join(vault, '.obsidian', 'settings.json'), '{}');
    await writeFile(outside, '# Escaped');
    await symlink(outside, join(vault, 'escape.md'));

    const adapter = new ObsidianAdapter();
    expect(await adapter.preview(grant('obsidian', vault))).toMatchObject({ estimatedRecords: 1 });
    const records = [];
    for await (const record of adapter.scan(grant('obsidian', vault))) records.push(record);
    const event = records.find((record) => record.kind === 'record');
    if (!event || event.kind !== 'record') throw new Error('missing note record');
    expect(adapter.redact(adapter.normalize(event.value), 'metadata').body).toBeNull();
    expect(event.value.title).toBe('safe');
  });
});

describe('Git adapter contract', () => {
  it('reads commit metadata without source file bodies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mw-git-'));
    await run('git', ['init'], { cwd: root });
    await run('git', ['config', 'user.name', 'Fixture Author'], { cwd: root });
    await run('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
    await writeFile(join(root, 'secret-source.txt'), 'source body must not be indexed');
    await run('git', ['add', '.'], { cwd: root });
    await run('git', ['commit', '-m', 'Anonymous initial checkpoint'], { cwd: root });

    const adapter = new GitAdapter();
    expect(await adapter.preview(grant('git', root))).toMatchObject({ estimatedRecords: 1 });
    const records = [];
    for await (const record of adapter.scan(grant('git', root))) records.push(record);
    const event = records.find((record) => record.kind === 'record');
    if (!event || event.kind !== 'record') throw new Error('missing commit record');
    const normalized = adapter.redact(adapter.normalize(event.value), 'metadata_and_body');
    expect(normalized.title).toBe('Anonymous initial checkpoint');
    expect(normalized.body).toBeNull();
    expect(JSON.stringify(normalized)).not.toContain('source body');
  });
});
