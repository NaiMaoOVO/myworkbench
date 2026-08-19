import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GrantBoundaryError, assertPathWithinGrant, canonicalizeGrantRoot } from '../src/platform/path-policy.js';

describe('grant path policy', () => {
  it('allows an existing file under a canonicalized grant root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mw-grant-'));
    const file = join(root, 'allowed.txt');
    await writeFile(file, 'safe');
    await expect(assertPathWithinGrant(await canonicalizeGrantRoot(root), file)).resolves.toContain('allowed.txt');
  });

  it('rejects a symlink that escapes the granted directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mw-symlink-'));
    const root = join(parent, 'grant');
    const outside = join(parent, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'not authorized');
    await symlink(secret, join(root, 'escape.txt'));
    await expect(assertPathWithinGrant(root, join(root, 'escape.txt'))).rejects.toBeInstanceOf(GrantBoundaryError);
  });
});
