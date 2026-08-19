import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

type JsonValue = null | boolean | number | string | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue };

type RequestState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

type Metric = {
  label: string;
  value: string;
};

type RuntimeState = {
  health: RequestState<JsonRecord>;
  dashboard: RequestState<JsonRecord>;
  refreshedAt: Date | null;
};

const initialState: RuntimeState = {
  health: { status: 'loading', data: null, error: null },
  dashboard: { status: 'loading', data: null, error: null },
  refreshedAt: null,
};

const privateField = /(body|content|path|token|secret|authorization|cookie|session)/i;
const ignoredMetricField = /^(id|status|version|updated|created|at|date|time)$/i;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function apiBaseUrl(): string {
  const url = new URL(window.location.href);
  const queryOverride = url.searchParams.get('apiOrigin');
  const injectedOrigin = (globalThis as typeof globalThis & {
    __MYWORKBENCH_API_ORIGIN__?: unknown;
  }).__MYWORKBENCH_API_ORIGIN__;
  const candidate = queryOverride ?? (typeof injectedOrigin === 'string' ? injectedOrigin : '');

  if (!candidate) {
    // M1's local API dev process uses 8788. A desktop shell can inject its
    // dynamically selected API origin through the global override above.
    return window.location.port === '8788' ? window.location.origin : 'http://127.0.0.1:8788';
  }

  try {
    const parsed = new URL(candidate);
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === '::1' || parsed.hostname === 'localhost';
    return isLoopback ? parsed.origin : window.location.origin;
  } catch {
    return window.location.origin;
  }
}

async function getJson(path: string, signal: AbortSignal): Promise<JsonRecord> {
  const response = await fetch(new URL(path, apiBaseUrl()), {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal,
  });

  if (!response.ok) {
    throw new Error(`The local service responded with ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new Error('The local service returned an unexpected response.');
  }

  return payload;
}

function valueLabel(value: JsonValue): string | null {
  if (typeof value === 'number') {
    return new Intl.NumberFormat().format(value);
  }
  if (typeof value === 'string' && value.length <= 48) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return null;
}

function readableLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractMetrics(dashboard: JsonRecord): Metric[] {
  const containers = [dashboard.metrics, dashboard.summary, dashboard.counts, dashboard.data, dashboard];
  const unique = new Map<string, Metric>();

  for (const container of containers) {
    if (!isRecord(container)) {
      continue;
    }

    for (const [key, value] of Object.entries(container)) {
      if (privateField.test(key) || ignoredMetricField.test(key)) {
        continue;
      }
      const label = valueLabel(value);
      if (label !== null && !unique.has(key)) {
        unique.set(key, { label: readableLabel(key), value: label });
      }
    }
  }

  return [...unique.values()].slice(0, 4);
}

function hasObservedData(dashboard: JsonRecord, metrics: Metric[]): boolean {
  if (metrics.some((metric) => metric.value !== '0')) {
    return true;
  }

  return Object.entries(dashboard).some(([key, value]) => {
    if (privateField.test(key)) {
      return false;
    }
    return Array.isArray(value) && value.length > 0;
  });
}

function healthLabel(health: JsonRecord): string {
  const value = health.status ?? health.health ?? health.ok;
  if (value === true || value === 'ok' || value === 'healthy' || value === 'ready') {
    return 'Local service ready';
  }
  if (typeof value === 'string') {
    return readableLabel(value);
  }
  return 'Local service connected';
}

function StatePanel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <section className="state-panel" aria-labelledby="state-title">
      <div className="state-indicator" aria-hidden="true" />
      <div>
        <h2 id="state-title">{title}</h2>
        <p>{detail}</p>
        {children}
      </div>
    </section>
  );
}

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>(initialState);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setRuntime((current) => ({
      ...current,
      health: { status: 'loading', data: null, error: null },
      dashboard: { status: 'loading', data: null, error: null },
    }));

    const [healthResult, dashboardResult] = await Promise.allSettled([
      getJson('/health', signal ?? new AbortController().signal),
      getJson('/api/dashboard', signal ?? new AbortController().signal),
    ]);

    if (signal?.aborted) {
      return;
    }

    setRuntime({
      health:
        healthResult.status === 'fulfilled'
          ? { status: 'ready', data: healthResult.value, error: null }
          : { status: 'error', data: null, error: healthResult.reason instanceof Error ? healthResult.reason.message : 'Health check failed.' },
      dashboard:
        dashboardResult.status === 'fulfilled'
          ? { status: 'ready', data: dashboardResult.value, error: null }
          : { status: 'error', data: null, error: dashboardResult.reason instanceof Error ? dashboardResult.reason.message : 'Dashboard request failed.' },
      refreshedAt: new Date(),
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const metrics = useMemo(
    () => (runtime.dashboard.status === 'ready' && runtime.dashboard.data ? extractMetrics(runtime.dashboard.data) : []),
    [runtime.dashboard],
  );
  const observedData = runtime.dashboard.status === 'ready' && runtime.dashboard.data ? hasObservedData(runtime.dashboard.data, metrics) : false;
  const hasError = runtime.health.status === 'error' || runtime.dashboard.status === 'error';
  const loading = runtime.health.status === 'loading' || runtime.dashboard.status === 'loading';

  return (
    <main className="cockpit-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="nav-pod" aria-label="Primary navigation">
        <div className="brand-mark" aria-hidden="true">
          MW
        </div>
        <nav>
          <a className="nav-item nav-item--active" href="#workspace" aria-current="page">
            <span aria-hidden="true">◉</span>
            Overview
          </a>
          <a className="nav-item" href="#data-state">
            <span aria-hidden="true">◌</span>
            Evidence
          </a>
          <a className="nav-item" href="#service-state">
            <span aria-hidden="true">◇</span>
            Local service
          </a>
        </nav>
        <p className="nav-footnote">Local-first<br />Read-only sources</p>
      </aside>

      <section id="workspace" className="workspace" aria-labelledby="page-title" tabIndex={-1}>
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Personal work evidence</p>
            <h1 id="page-title">MyWorkbench</h1>
          </div>
          <button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loading || refreshing}>
            <span aria-hidden="true">↻</span>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </header>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {loading ? 'Loading local service and dashboard.' : hasError ? 'Some local data could not be loaded.' : 'Local dashboard updated.'}
        </div>

        {loading ? (
          <StatePanel title="Loading local evidence" detail="Checking the local service and reading the dashboard." />
        ) : hasError ? (
          <StatePanel title="Local data is unavailable" detail="The shell could not load one or more local read endpoints.">
            <button className="text-button" type="button" onClick={() => void refresh()}>
              Try again
            </button>
          </StatePanel>
        ) : !observedData ? (
          <StatePanel
            title="No indexed evidence yet"
            detail="The local service is connected, but the dashboard has no visible evidence. Authorize a source and run a scan to populate this view."
          />
        ) : (
          <section id="data-state" className="dashboard-content" aria-label="Dashboard data">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Observed dashboard data</p>
                <h2>Current evidence</h2>
              </div>
              {runtime.refreshedAt ? <time dateTime={runtime.refreshedAt.toISOString()}>Updated just now</time> : null}
            </div>
            <div className="metrics-grid">
              {metrics.map((metric) => (
                <article className="metric-card" key={metric.label}>
                  <p>{metric.label}</p>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

      <aside id="service-state" className="evidence-panel" aria-labelledby="service-title">
        <div className="panel-header">
          <p className="eyebrow">Runtime</p>
          <span className={runtime.health.status === 'ready' ? 'health-dot health-dot--ready' : 'health-dot'} aria-hidden="true" />
        </div>
        <h2 id="service-title">Local service</h2>
        {runtime.health.status === 'loading' ? <p className="muted">Checking health endpoint…</p> : null}
        {runtime.health.status === 'ready' && runtime.health.data ? <p className="service-status">{healthLabel(runtime.health.data)}</p> : null}
        {runtime.health.status === 'error' ? <p className="error-copy">{runtime.health.error}</p> : null}

        <div className="privacy-note">
          <span aria-hidden="true">⌁</span>
          <p>Only local read endpoints are used. This shell does not request source content directly.</p>
        </div>

        <dl className="endpoint-list">
          <div>
            <dt>Health</dt>
            <dd>{runtime.health.status}</dd>
          </div>
          <div>
            <dt>Dashboard</dt>
            <dd>{runtime.dashboard.status}</dd>
          </div>
        </dl>
      </aside>
    </main>
  );
}
