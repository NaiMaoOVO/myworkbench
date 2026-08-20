import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalApiServer } from '../src/local-api/server.js';
import { WorkbenchSourceService } from '../src/core/source-service.js';

const appOrigin = 'http://app.myworkbench.test';
const credentials = {
  origin: appOrigin,
  'content-type': 'application/json',
  'x-mw-installation-secret': 'test-installation-secret',
  'x-mw-csrf-token': 'test-csrf-token',
};

let api: LocalApiServer | undefined;
let sourceService: WorkbenchSourceService | undefined;

afterEach(async () => {
  sourceService?.close();
  await api?.stop();
  sourceService = undefined;
  api = undefined;
});

async function startApi(): Promise<{ base: string; fixtureRoot: string; databasePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mw-api-'));
  const fixtureRoot = join(root, 'fixture');
  await cp('fixtures/anonymous/exports', fixtureRoot, { recursive: true });
  const databasePath = join(root, 'workbench.sqlite');
  api = new LocalApiServer({
    databasePath,
    appOrigin,
    installationSecret: credentials['x-mw-installation-secret'],
    csrfToken: credentials['x-mw-csrf-token'],
  });
  const port = await api.start();
  return { base: `http://127.0.0.1:${port}`, fixtureRoot, databasePath };
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

    const heatmap = await fetch(`${base}/api/heatmap`);
    expect(await json(heatmap)).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat' })]) });

    const events = await fetch(`${base}/api/events`);
    expect(await json(events)).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat', workspace: 'sample-product' })]) });

    const projects = await fetch(`${base}/api/projects`);
    expect(await json(projects)).toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ name: 'sample-product', eventCount: 2 })]) });

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

  it('shows source-service scans through the separate local API SQLite connection', async () => {
    const { base, fixtureRoot, databasePath } = await startApi();
    sourceService = new WorkbenchSourceService(databasePath);
    const handle = await sourceService.createSelection('exports-compat', fixtureRoot);
    await sourceService.previewSelection('exports-compat', handle, 'metadata');
    await sourceService.grant('exports-compat', handle, 'metadata');
    await sourceService.scan('exports-compat');

    const dashboard = await fetch(`${base}/api/dashboard`);
    expect(await json(dashboard)).toMatchObject({ eventCount: 2, projectCount: 1, dataState: 'ready' });
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
