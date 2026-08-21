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

export interface LocalApiRequest {
  method?: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
}

export interface LocalApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
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
    let body = '';
    try {
      if (method !== 'GET' && method !== 'OPTIONS') body = await readRequestBody(request);
    } catch {
      const result = this.errorResponse(request.headers.origin, 400, 'invalid_request');
      response.writeHead(result.status, result.headers);
      response.end(result.body);
      return;
    }
    const result = await this.request({ method, url: request.url ?? '/', headers: request.headers, body });
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  }

  /**
   * Dispatches the production API without requiring a network socket.
   * The desktop HTTP listener and integration tests use this same path.
   */
  async request(input: LocalApiRequest): Promise<LocalApiResponse> {
    const method = input.method ?? 'GET';
    const url = new URL(input.url, 'http://127.0.0.1');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const requestHeaders = input.headers ?? {};
    const origin = getHeader(requestHeaders, 'origin');
    if (origin === this.security.appOrigin) {
      headers['Access-Control-Allow-Origin'] = this.security.appOrigin;
      headers.Vary = 'Origin';
    }

    if (method === 'OPTIONS') {
      if (origin !== this.security.appOrigin) return this.response(403, headers, { error: 'origin_rejected' });
      return { status: 204, headers: { ...headers, 'Access-Control-Allow-Origin': this.security.appOrigin, 'Access-Control-Allow-Headers': 'content-type, x-mw-installation-secret, x-mw-csrf-token', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS' }, body: '' };
    }

    try {
      if (method === 'GET') return this.handleRead(url, headers);
      if (!this.isAuthorizedControlRequest(requestHeaders)) return this.response(403, headers, { error: 'control_request_rejected' });
      if (typeof input.body === 'string' && Buffer.byteLength(input.body, 'utf8') > jsonLimit) throw new Error('Request body is too large.');
      const body = parseJsonBody(input.body ?? '');
      return await this.handleControl(method, url, body, headers);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected local API error.';
      const code = message.includes('outside the authorized') ? 403 : message.includes('Unsupported') ? 404 : 400;
      return this.response(code, headers, { error: code === 403 ? 'grant_boundary_rejected' : 'invalid_request' });
    }
  }

  private handleRead(url: URL, headers: Record<string, string>): LocalApiResponse {
    const path = url.pathname;
    if (path === '/health') return this.response(200, headers, { status: 'ready', storage: 'ready' });
    if (path === '/api/dashboard') return this.response(200, headers, this.runtime.database.dashboard());
    if (path === '/api/heatmap') return this.response(200, headers, { events: this.runtime.database.listEvents(1000).map((event) => ({ occurredAt: event.occurredAt, sourceId: event.sourceId })) });
    if (path === '/api/events') return this.response(200, headers, { events: this.runtime.database.listEvents() });
    if (path === '/api/projects') return this.response(200, headers, { projects: projectsFromEvents(this.runtime.database.listEvents(1000)) });
    if (path === '/api/content') return this.response(200, headers, { content: this.runtime.database.listEvents().map(({ id, sourceId, occurredAt, title }) => ({ id, sourceId, occurredAt, title })) });
    if (path === '/api/quality') return this.response(200, headers, this.runtime.database.quality());
    if (path === '/api/sources') {
      const states = new Map(this.runtime.database.listSources().map((source) => [source.id, source]));
      return this.response(200, headers, { sources: this.runtime.catalog.map((manifest) => ({ ...manifest, ...(states.get(manifest.id) ?? { state: 'undiscovered', lastScanAt: null }) })) });
    }
    if (path === '/api/scans') return this.response(200, headers, { scans: this.runtime.database.listScanRuns() });
    if (path === '/api/diagnostics') return this.response(200, headers, { diagnostics: this.runtime.database.listDiagnostics() });
    if (path === '/api/settings') return this.response(200, headers, { telemetry: 'disabled', scanFrequency: 'manual' });
    return this.response(404, headers, { error: 'not_found' });
  }

  private async handleControl(method: string, url: URL, body: JsonObject, headers: Record<string, string>): Promise<LocalApiResponse> {
    const match = url.pathname.match(/^\/api\/sources\/([^/]+)\/(grants|preview|scan|pause|index)$/);
    if (!match) {
      if (method === 'POST' && url.pathname === '/api/sources/discover') return this.response(200, headers, { sources: [] });
      if (method === 'PATCH' && url.pathname === '/api/settings') return this.response(200, headers, { updated: true });
      return this.response(404, headers, { error: 'not_found' });
    }

    const [, sourceId, action] = match;
    if (action === 'grants' && method === 'POST') {
      const root = typeof body.root === 'string' ? await canonicalizeGrantRoot(body.root) : null;
      const scope = body.scope === 'metadata_and_body' ? 'metadata_and_body' : body.scope === 'metadata' ? 'metadata' : null;
      if (!root || !scope) return this.response(400, headers, { error: 'invalid_grant' });
      const grant = this.runtime.database.saveGrant(sourceId, root, scope as ContentScope);
      return this.response(201, headers, { grant: { sourceId: grant.sourceId, scope: grant.scope, grantedAt: grant.grantedAt } });
    }
    if (action === 'grants' && method === 'DELETE') {
      this.runtime.database.revokeGrant(sourceId);
      return this.response(200, headers, { revoked: true });
    }
    if (action === 'preview' && method === 'POST') {
      const grant = this.runtime.database.getGrant(sourceId);
      if (!grant || grant.revokedAt) return this.response(403, headers, { error: 'grant_required' });
      return this.response(200, headers, { preview: await this.runtime.scanner.preview(sourceId, grant) });
    }
    if (action === 'scan' && method === 'POST') {
      return this.response(200, headers, { scan: await this.runtime.scanner.scan(sourceId) });
    }
    if (action === 'pause' && method === 'POST') return this.response(409, headers, { error: 'no_active_scan' });
    if (action === 'index' && method === 'DELETE') {
      this.runtime.database.deleteSourceIndex(sourceId);
      return this.response(200, headers, { deleted: true });
    }
    return this.response(405, headers, { error: 'method_not_allowed' });
  }

  private isAuthorizedControlRequest(headers: Record<string, string | string[] | undefined>): boolean {
    const contentType = getHeader(headers, 'content-type') ?? '';
    return getHeader(headers, 'origin') === this.security.appOrigin
      && getHeader(headers, 'x-mw-installation-secret') === this.security.installationSecret
      && getHeader(headers, 'x-mw-csrf-token') === this.security.csrfToken
      && contentType.toLowerCase().startsWith('application/json');
  }

  private response(status: number, headers: Record<string, string>, data: unknown): LocalApiResponse {
    return { status, headers, body: JSON.stringify(data) };
  }

  private errorResponse(origin: string | undefined, status: number, code: string): LocalApiResponse {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (origin === this.security.appOrigin) {
      headers['Access-Control-Allow-Origin'] = this.security.appOrigin;
      headers.Vary = 'Origin';
    }
    return this.response(status, headers, { error: code });
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

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > jsonLimit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonBody(text: string): JsonObject {
  if (!text) return {};
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Request JSON must be an object.');
  return value as JsonObject;
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[Object.keys(headers).find((key) => key.toLowerCase() === name) ?? ''];
  return Array.isArray(value) ? value[0] : value;
}
