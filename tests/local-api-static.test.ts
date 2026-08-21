import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { LocalApiServer } from '../src/local-api/server.js';

describe('packaged UI static hosting', () => {
  let server: LocalApiServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('serves index and hashed assets from uiRoot on the same origin', async () => {
    const uiRoot = await mkdtemp(join(tmpdir(), 'mw-ui-'));
    await mkdir(join(uiRoot, 'assets'), { recursive: true });
    await writeFile(join(uiRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
    await writeFile(join(uiRoot, 'assets', 'index-test.js'), 'console.log("ui");');
    server = new LocalApiServer({ databasePath: ':memory:', appOrigin: 'http://127.0.0.1:1', uiRoot });

    const index = await server.request({ method: 'GET', url: '/' });
    expect(index.status).toBe(200);
    expect(index.headers['Content-Type']).toContain('text/html');
    expect(index.headers['Cache-Control']).toBe('no-store');
    expect(index.headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(index.raw?.toString('utf8')).toContain('id="root"');

    const asset = await server.request({ method: 'GET', url: '/assets/index-test.js' });
    expect(asset.status).toBe(200);
    expect(asset.headers['Content-Type']).toContain('text/javascript');
    expect(asset.raw?.toString('utf8')).toContain('ui');

    // The API stays reachable on the same origin.
    const health = await server.request({ method: 'GET', url: '/health' });
    expect(health.status).toBe(200);
  });

  it('rejects traversal and unknown paths without leaking errors', async () => {
    const uiRoot = await mkdtemp(join(tmpdir(), 'mw-ui-'));
    await writeFile(join(uiRoot, 'index.html'), '<html></html>');
    server = new LocalApiServer({ databasePath: ':memory:', appOrigin: 'http://127.0.0.1:1', uiRoot });

    for (const url of ['/../secret.txt', '/..%2F..%2Fsecret.txt', '/missing.js', '/%2e%2e/secret.txt']) {
      const response = await server.request({ method: 'GET', url });
      expect([403, 404]).toContain(response.status);
      expect(response.body).not.toContain('secret');
    }
  });

  it('keeps the API-only behaviour when no uiRoot is configured', async () => {
    server = new LocalApiServer({ databasePath: ':memory:', appOrigin: 'http://127.0.0.1:1' });
    const response = await server.request({ method: 'GET', url: '/' });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: 'not_found' });
  });
});
