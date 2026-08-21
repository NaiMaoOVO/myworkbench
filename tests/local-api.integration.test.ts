import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalApiServer, type LocalApiResponse } from '../src/local-api/server.js';
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

async function startApi(): Promise<{ fixtureRoot: string; databasePath: string }> {
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
  return { fixtureRoot, databasePath };
}

async function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<LocalApiResponse> {
  return api!.request({ url: path, method: init.method, headers: init.headers, body: init.body });
}

async function json(response: LocalApiResponse): Promise<Record<string, unknown>> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe('local API authorization and scan lifecycle', () => {
  it('runs grant → preview → scan → read APIs → revoke → delete-index using SQLite', async () => {
    const { fixtureRoot } = await startApi();
    expect(await json(await request('/health'))).toMatchObject({ status: 'ready', storage: 'ready' });

    const sources = await request('/api/sources');
    expect(await json(sources)).toMatchObject({ sources: expect.arrayContaining([
      expect.objectContaining({ id: 'exports-compat' }),
      expect.objectContaining({ id: 'obsidian' }),
      expect.objectContaining({ id: 'git' }),
      expect.objectContaining({ id: 'codex' }),
      expect.objectContaining({ id: 'claude' }),
      expect.objectContaining({ id: 'openclaw', state: 'unsupported' }),
    ]) });

    const rejected = await request('/api/sources/exports-compat/grants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: fixtureRoot, scope: 'metadata' }) });
    expect(rejected.status).toBe(403);

    const granted = await request('/api/sources/exports-compat/grants', { method: 'POST', headers: credentials, body: JSON.stringify({ root: fixtureRoot, scope: 'metadata' }) });
    expect(granted.status).toBe(201);

    const preview = await request('/api/sources/exports-compat/preview', { method: 'POST', headers: credentials, body: '{}' });
    expect(await json(preview)).toMatchObject({ preview: { estimatedRecords: 2 } });

    const scan = await request('/api/sources/exports-compat/scan', { method: 'POST', headers: credentials, body: '{}' });
    expect(await json(scan)).toMatchObject({ scan: { status: 'partial', parsed: 2, failed: 1 } });

    const dashboard = await request('/api/dashboard', { headers: { origin: appOrigin } });
    expect(dashboard.headers['Access-Control-Allow-Origin']).toBe(appOrigin);
    expect(await json(dashboard)).toMatchObject({ eventCount: 2, projectCount: 1, dataState: 'ready' });

    const heatmap = await request('/api/heatmap');
    expect(await json(heatmap)).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat' })]) });

    const events = await request('/api/events');
    expect(await json(events)).toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat', workspace: 'sample-product' })]) });

    const projects = await request('/api/projects');
    expect(await json(projects)).toMatchObject({ projects: expect.arrayContaining([expect.objectContaining({ name: 'sample-product', eventCount: 2 })]) });

    const content = await request('/api/content');
    const contentPayload = await json(content);
    expect(contentPayload).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat', title: expect.any(String) })]) });
    expect(JSON.stringify(contentPayload)).not.toContain('synthetic body');

    const quality = await request('/api/quality');
    expect(await json(quality)).toMatchObject({ scans: 1, partial: 1, blocked: 0, diagnostics: expect.arrayContaining([expect.objectContaining({ sourceId: 'exports-compat', safeMessage: expect.any(String) })]) });

    const scans = await request('/api/scans');
    expect(await json(scans)).toMatchObject({ scans: [expect.objectContaining({ sourceId: 'exports-compat', status: 'partial', parsed: 2, failed: 1 })] });

    const revoked = await request('/api/sources/exports-compat/grants', { method: 'DELETE', headers: credentials, body: '{}' });
    expect(revoked.status).toBe(200);

    const deleted = await request('/api/sources/exports-compat/index', { method: 'DELETE', headers: credentials, body: '{}' });
    expect(deleted.status).toBe(200);
    expect(await json(await request('/api/dashboard'))).toMatchObject({ eventCount: 0, dataState: 'empty' });
  });

  it('shows source-service scans through the separate local API SQLite connection', async () => {
    const { fixtureRoot, databasePath } = await startApi();
    sourceService = new WorkbenchSourceService(databasePath);
    const handle = await sourceService.createSelection('exports-compat', fixtureRoot);
    await sourceService.previewSelection('exports-compat', handle, 'metadata');
    await sourceService.grant('exports-compat', handle, 'metadata');
    await sourceService.scan('exports-compat');

    const dashboard = await request('/api/dashboard');
    expect(await json(dashboard)).toMatchObject({ eventCount: 2, projectCount: 1, dataState: 'ready' });
  });

  it('rejects the wrong Origin and never reflects a permissive CORS origin', async () => {
    await startApi();
    const response = await request('/api/sources/exports-compat/scan', {
      method: 'POST',
      headers: { ...credentials, origin: 'https://malicious.example' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('rejects missing CSRF credentials and invalid preflight origins', async () => {
    await startApi();
    const { ['x-mw-csrf-token']: _csrf, ...missingCsrf } = credentials;

    const control = await request('/api/sources/exports-compat/scan', { method: 'POST', headers: missingCsrf, body: '{}' });
    expect(control.status).toBe(403);
    expect(await json(control)).toEqual({ error: 'control_request_rejected' });

    const preflight = await request('/api/sources/exports-compat/scan', { method: 'OPTIONS', headers: { origin: 'https://malicious.example' } });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(await json(preflight)).toEqual({ error: 'origin_rejected' });
  });

  it('rejects oversized JSON bodies without reflecting private input', async () => {
    await startApi();
    const privateMarker = 'private-path-marker';
    const response = await request('/api/sources/exports-compat/grants', {
      method: 'POST',
      headers: credentials,
      body: JSON.stringify({ root: privateMarker.repeat(4_000), scope: 'metadata' }),
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: 'invalid_request' });
    expect(response.body).not.toContain(privateMarker);
  });
});
