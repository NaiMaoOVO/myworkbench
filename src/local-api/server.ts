import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { ContentScope } from '../core/types.js';
import { createWorkbenchRuntime } from '../core/runtime.js';
import { canonicalizeGrantRoot } from '../platform/path-policy.js';

interface ApiSecurity {
  appOrigin: string;
  installationSecret: string;
  csrfToken: string;
}

export interface LocalApiOptions {
  databasePath: string;
  appOrigin: string;
  installationSecret?: string;
  csrfToken?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

const jsonLimit = 32 * 1024;

export class LocalApiServer {
  readonly security: ApiSecurity;
  readonly runtime;
  readonly #server: Server;

  constructor(options: LocalApiOptions) {
    this.security = {
      appOrigin: options.appOrigin,
      installationSecret: options.installationSecret ?? randomBytes(32).toString('base64url'),
      csrfToken: options.csrfToken ?? randomUUID(),
    };
    this.runtime = createWorkbenchRuntime(options.databasePath);
    this.#server = createServer((request, response) => void this.handle(request, response));
  }

  async start(port = 0): Promise<number> {
    this.#server.listen(port, '127.0.0.1');
    await once(this.#server, 'listening');
    return (this.#server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (this.#server.listening) {
      this.#server.close();
      await once(this.#server, 'close');
    }
    this.runtime.database.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.headers.origin === this.security.appOrigin) {
      headers['Access-Control-Allow-Origin'] = this.security.appOrigin;
      headers.Vary = 'Origin';
    }

    if (method === 'OPTIONS') {
      if (request.headers.origin !== this.security.appOrigin) return this.respond(response, 403, headers, { error: 'origin_rejected' });
      response.writeHead(204, { ...headers, 'Access-Control-Allow-Origin': this.security.appOrigin, 'Access-Control-Allow-Headers': 'content-type, x-mw-installation-secret, x-mw-csrf-token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS' });
      response.end();
      return;
    }

    try {
      if (method === 'GET') return this.handleRead(url, response, headers);
      if (!this.isAuthorizedControlRequest(request)) return this.respond(response, 403, headers, { error: 'control_request_rejected' });
      const body = await readJsonBody(request);
      return await this.handleControl(method, url, body, response, headers);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected local API error.';
      const code = message.includes('outside the authorized') ? 403 : message.includes('Unsupported') ? 404 : 400;
      return this.respond(response, code, headers, { error: code === 403 ? 'grant_boundary_rejected' : 'invalid_request' });
    }
  }

  private handleRead(url: URL, response: ServerResponse, headers: Record<string, string>): void {
    const path = url.pathname;
    if (path === '/health') return this.respond(response, 200, headers, { status: 'ready', storage: 'ready' });
    if (path === '/api/dashboard') return this.respond(response, 200, headers, this.runtime.database.dashboard());
    if (path === '/api/heatmap') return this.respond(response, 200, headers, { events: this.runtime.database.listEvents(1000).map((event) => ({ occurredAt: event.occurredAt, sourceId: event.sourceId })) });
    if (path === '/api/events') return this.respond(response, 200, headers, { events: this.runtime.database.listEvents() });
    if (path === '/api/projects') return this.respond(response, 200, headers, { projects: projectsFromEvents(this.runtime.database.listEvents(1000)) });
    if (path === '/api/content') return this.respond(response, 200, headers, { content: this.runtime.database.listEvents().map(({ id, sourceId, occurredAt, title }) => ({ id, sourceId, occurredAt, title })) });
    if (path === '/api/quality') return this.respond(response, 200, headers, this.runtime.database.quality());
    if (path === '/api/sources') return this.respond(response, 200, headers, { sources: this.runtime.database.listSources() });
    if (path === '/api/scans') return this.respond(response, 200, headers, { scans: this.runtime.database.listScanRuns() });
    if (path === '/api/diagnostics') return this.respond(response, 200, headers, { diagnostics: this.runtime.database.listDiagnostics() });
    if (path === '/api/settings') return this.respond(response, 200, headers, { telemetry: 'disabled', scanFrequency: 'manual' });
    return this.respond(response, 404, headers, { error: 'not_found' });
  }

  private async handleControl(method: string, url: URL, body: JsonObject, response: ServerResponse, headers: Record<string, string>): Promise<void> {
    const match = url.pathname.match(/^\/api\/sources\/([^/]+)\/(grants|preview|scan|pause|index)$/);
    if (!match) {
      if (method === 'POST' && url.pathname === '/api/sources/discover') return this.respond(response, 200, headers, { sources: [] });
      if (method === 'PATCH' && url.pathname === '/api/settings') return this.respond(response, 200, headers, { updated: true });
      return this.respond(response, 404, headers, { error: 'not_found' });
    }

    const [, sourceId, action] = match;
    if (action === 'grants' && method === 'POST') {
      const root = typeof body.root === 'string' ? await canonicalizeGrantRoot(body.root) : null;
      const scope = body.scope === 'metadata_and_body' ? 'metadata_and_body' : body.scope === 'metadata' ? 'metadata' : null;
      if (!root || !scope) return this.respond(response, 400, headers, { error: 'invalid_grant' });
      const grant = this.runtime.database.saveGrant(sourceId, root, scope as ContentScope);
      return this.respond(response, 201, headers, { grant: { sourceId: grant.sourceId, scope: grant.scope, grantedAt: grant.grantedAt } });
    }
    if (action === 'grants' && method === 'DELETE') {
      this.runtime.database.revokeGrant(sourceId);
      return this.respond(response, 200, headers, { revoked: true });
    }
    if (action === 'preview' && method === 'POST') {
      const grant = this.runtime.database.getGrant(sourceId);
      if (!grant || grant.revokedAt) return this.respond(response, 403, headers, { error: 'grant_required' });
      return this.respond(response, 200, headers, { preview: await this.runtime.scanner.preview(sourceId, grant) });
    }
    if (action === 'scan' && method === 'POST') {
      return this.respond(response, 200, headers, { scan: await this.runtime.scanner.scan(sourceId) });
    }
    if (action === 'pause' && method === 'POST') return this.respond(response, 409, headers, { error: 'no_active_scan' });
    if (action === 'index' && method === 'DELETE') {
      this.runtime.database.deleteSourceIndex(sourceId);
      return this.respond(response, 200, headers, { deleted: true });
    }
    return this.respond(response, 405, headers, { error: 'method_not_allowed' });
  }

  private isAuthorizedControlRequest(request: IncomingMessage): boolean {
    const contentType = request.headers['content-type'] ?? '';
    return request.headers.origin === this.security.appOrigin
      && request.headers['x-mw-installation-secret'] === this.security.installationSecret
      && request.headers['x-mw-csrf-token'] === this.security.csrfToken
      && contentType.toLowerCase().startsWith('application/json');
  }

  private respond(response: ServerResponse, status: number, headers: Record<string, string>, data: unknown): void {
    response.writeHead(status, headers);
    response.end(JSON.stringify(data));
  }
}

function projectsFromEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const projects = new Map<string, { name: string; eventCount: number; lastActivity: string }>();
  for (const event of events) {
    const workspace = typeof event.workspace === 'string' && event.workspace ? event.workspace : 'Unassigned evidence';
    const occurredAt = String(event.occurredAt);
    const current = projects.get(workspace);
    projects.set(workspace, {
      name: workspace,
      eventCount: (current?.eventCount ?? 0) + 1,
      lastActivity: current && current.lastActivity > occurredAt ? current.lastActivity : occurredAt,
    });
  }
  return [...projects.values()].sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > jsonLimit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Request JSON must be an object.');
  return value as JsonObject;
}
