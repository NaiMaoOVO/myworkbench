/** Shared loopback API client for every cockpit view. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function apiBaseUrl(): string {
  const candidate = new URL(window.location.href).searchParams.get('apiOrigin') ?? '';
  try {
    const parsed = new URL(candidate);
    return ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname) ? parsed.origin : window.location.origin;
  } catch {
    return 'http://127.0.0.1:8788';
  }
}

export async function readJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, apiBaseUrl()), { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`本地服务响应了 ${response.status}。`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('本地服务返回了意外的响应格式。');
  return payload;
}
