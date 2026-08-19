import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalApiServer } from '../src/local-api/server.js';

const appOrigin = 'http://app.myworkbench.test';
const credentials = {
  origin: appOrigin,
  'content-type': 'application/json',
  'x-mw-installation-secret': 'test-installation-secret',
  'x-mw-csrf-token': 'test-csrf-token',
};

let api: LocalApiServer | undefined;

afterEach(async () => api?.stop());

async function startApi(): Promise<{ base: string; fixtureRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mw-api-'));
  const fixtureRoot = join(root, 'fixture');
  await cp('fixtures/anonymous/exports', fixtureRoot, { recursive: true });
  api = new LocalApiServer({
    databasePath: join(root, 'workbench.sqlite'),
    appOrigin,
    installationSecret: credentials['x-mw-installation-secret'],
    csrfToken: credentials['x-mw-csrf-token'],
  });
  const port = await api.start();
  return { base: `http://127.0.0.1:${port}`, fixtureRoot };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('local API authorization and scan lifecycle', () => {
  it('runs grant → preview → scan → read APIs → revoke → delete-index using SQLite', async () => {
    const { base, fixtureRoot } = await startApi();
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ status: 'ready', storage: 'ready' });

    const sources = await fetch(`${base}/api/sources`);
    expect(await json(sources)).toMatchObject({ sources: expect.arrayContaining([
      expect.objectContaining({ id: 'exports-compat' }),
      expect.objectContaining({ id: 'obsidian' }),
      expect.objectContaining({ id: 'git' }),
      expect.objectContaining({ id: 'codex' }),
      expect.objectContaining({ id: 'claude' }),
      expect.objectContaining({ id: 'openclaw', state: 'unsupported' }),
    ]) });

    const rejected = await fetch(`${base}/api/sources/exports-compat/grants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: fixtureRoot, scope: 'metadata' }) });
    expect(rejected.status).toBe(403);

    const granted = await fetch(`${base}/api/sources/exports-compat/grants`, { method: 'POST', headers: credentials, body: JSON.stringify({ root: fixtureRoot, scope: 'metadata' }) });
    expect(granted.status).toBe(201);

    const preview = await fetch(`${base}/api/sources/exports-compat/preview`, { method: 'POST', headers: credentials, body: '{}' });
    expect(await json(preview)).toMatchObject({ preview: { estimatedRecords: 2 } });

    const scan = await fetch(`${base}/api/sources/exports-compat/scan`, { method: 'POST', headers: credentials, body: '{}' });
    expect(await json(scan)).toMatchObject({ scan: { status: 'partial', parsed: 2, failed: 1 } });

    const dashboard = await fetch(`${base}/api/dashboard`, { headers: { origin: appOrigin } });
    expect(dashboard.headers.get('access-control-allow-origin')).toBe(appOrigin);
    expect(await json(dashboard)).toMatchObject({ eventCount: 2, projectCount: 1, dataState: 'ready' });

    const content = await fetch(`${base}/api/content`);
    expect(JSON.stringify(await json(content))).not.toContain('synthetic body');

    const quality = await fetch(`${base}/api/quality`);
    expect(await json(quality)).toMatchObject({ scans: 1, partial: 1 });

    const revoked = await fetch(`${base}/api/sources/exports-compat/grants`, { method: 'DELETE', headers: credentials, body: '{}' });
    expect(revoked.status).toBe(200);

    const deleted = await fetch(`${base}/api/sources/exports-compat/index`, { method: 'DELETE', headers: credentials, body: '{}' });
    expect(deleted.status).toBe(200);
    expect(await json(await fetch(`${base}/api/dashboard`))).toMatchObject({ eventCount: 0, dataState: 'empty' });
  });

  it('rejects the wrong Origin and never reflects a permissive CORS origin', async () => {
    const { base } = await startApi();
    const response = await fetch(`${base}/api/sources/exports-compat/scan`, {
      method: 'POST',
      headers: { ...credentials, origin: 'https://malicious.example' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
