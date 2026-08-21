import { useEffect, useState } from 'react';

type QualityPayload = {
  scans: number;
  partial: number;
  blocked: number;
  diagnostics: Array<{ sourceId: string; code: string; severity: string; safeMessage: string; createdAt: string }>;
};

type Scan = { id: string; sourceId: string; status: string; startedAt: string; endedAt: string | null; parsed: number; failed: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function apiBaseUrl(): string {
  const candidate = new URL(window.location.href).searchParams.get('apiOrigin') ?? '';
  try {
    const parsed = new URL(candidate);
    return ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname) ? parsed.origin : window.location.origin;
  } catch {
    return 'http://127.0.0.1:8788';
  }
}

async function readJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(path, apiBaseUrl()), { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`The local service responded with ${response.status}.`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('The quality endpoint returned an unexpected response.');
  return payload;
}

function qualityFrom(value: Record<string, unknown>): QualityPayload {
  const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics.flatMap((item) => {
    if (!isRecord(item) || typeof item.sourceId !== 'string' || typeof item.code !== 'string' || typeof item.severity !== 'string' || typeof item.safeMessage !== 'string' || typeof item.createdAt !== 'string') return [];
    return [{ sourceId: item.sourceId, code: item.code, severity: item.severity, safeMessage: item.safeMessage, createdAt: item.createdAt }];
  }) : [];
  return { scans: typeof value.scans === 'number' ? value.scans : 0, partial: typeof value.partial === 'number' ? value.partial : 0, blocked: typeof value.blocked === 'number' ? value.blocked : 0, diagnostics };
}

function scansFrom(value: Record<string, unknown>): Scan[] {
  if (!Array.isArray(value.scans)) return [];
  return value.scans.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string' || typeof item.status !== 'string' || typeof item.startedAt !== 'string' || typeof item.parsed !== 'number' || typeof item.failed !== 'number') return [];
    return [{ id: item.id, sourceId: item.sourceId, status: item.status, startedAt: item.startedAt, endedAt: typeof item.endedAt === 'string' ? item.endedAt : null, parsed: item.parsed, failed: item.failed }];
  });
}

export function QualityView({ refreshKey }: { refreshKey: number }) {
  const [quality, setQuality] = useState<QualityPayload | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    Promise.all([readJson('/api/quality', controller.signal), readJson('/api/scans', controller.signal)])
      .then(([qualityPayload, scansPayload]) => {
        if (controller.signal.aborted) return;
        setQuality(qualityFrom(qualityPayload));
        setScans(scansFrom(scansPayload));
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [refreshKey]);

  return (
    <section className="view-panel quality-view" aria-labelledby="quality-view-title">
      <div className="view-heading"><div><p className="eyebrow">Data explanation</p><h2 id="quality-view-title">Coverage and diagnostics</h2></div><p className="muted">Observed scan outcomes, not inferred completeness.</p></div>
      {state === 'loading' ? <p className="muted">Loading scan quality…</p> : null}
      {state === 'error' ? <p className="error-copy">Quality data is unavailable. Check the local service and try again.</p> : null}
      {quality ? <>
        <div className="quality-metrics">
          <div><span>Scans</span><strong>{quality.scans}</strong></div>
          <div><span>Partial</span><strong>{quality.partial}</strong></div>
          <div><span>Blocked</span><strong>{quality.blocked}</strong></div>
          <div><span>Diagnostics</span><strong>{quality.diagnostics.length}</strong></div>
        </div>
        <div className="quality-section"><h3>Recent scan runs</h3>{scans.length === 0 ? <p className="muted">No scans have been recorded.</p> : <ul className="scan-list">{scans.slice(0, 12).map((scan) => <li key={scan.id}><span className={`scan-status scan-status--${scan.status}`}>{scan.status}</span><strong>{scan.sourceId}</strong><span>{scan.parsed} parsed · {scan.failed} failed</span><time dateTime={scan.startedAt}>{new Date(scan.startedAt).toLocaleString()}</time></li>)}</ul>}</div>
        <div className="quality-section"><h3>Diagnostics</h3>{quality.diagnostics.length === 0 ? <p className="muted">No diagnostics recorded.</p> : <ul className="diagnostic-list">{quality.diagnostics.slice(0, 12).map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><span className={`severity severity--${diagnostic.severity}`}>{diagnostic.severity}</span><div><strong>{diagnostic.code}</strong><p>{diagnostic.safeMessage}</p></div><small>{diagnostic.sourceId}</small></li>)}</ul>}</div>
      </> : null}
    </section>
  );
}
