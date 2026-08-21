import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ProjectRack, type ProjectSelection } from './ProjectRack';
import { ActivityTimeline } from './ActivityTimeline';
import { ContentView } from './ContentView';
import { QualityView } from './QualityView';

type JsonValue = null | boolean | number | string | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue };
type ContentScope = 'metadata' | 'metadata_and_body';

type RequestState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: string };

type Metric = { label: string; value: string };
type SourceSummary = { id: string; displayName: string; state: string; supportsBodies: boolean; version: string };
type OperationState = { busy: string | null; message: string | null; error: string | null };
type ActiveView = 'overview' | 'content' | 'quality' | 'sources';

type RuntimeState = {
  health: RequestState<JsonRecord>;
  dashboard: RequestState<JsonRecord>;
  sources: RequestState<SourceSummary[]>;
  refreshedAt: Date | null;
};

const initialState: RuntimeState = {
  health: { status: 'loading', data: null, error: null },
  dashboard: { status: 'loading', data: null, error: null },
  sources: { status: 'loading', data: null, error: null },
  refreshedAt: null,
};

const privateField = /(body|content|path|token|secret|authorization|cookie|session)/i;
const ignoredMetricField = /^(id|status|version|updated|created|at|date|time)$/i;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function apiBaseUrl(): string {
  const url = new URL(window.location.href);
  const candidate = url.searchParams.get('apiOrigin') ?? '';
  try {
    const parsed = new URL(candidate);
    return ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname) ? parsed.origin : window.location.origin;
  } catch {
    return 'http://127.0.0.1:8788';
  }
}

async function getJson(path: string, signal: AbortSignal): Promise<JsonRecord> {
  const response = await fetch(new URL(path, apiBaseUrl()), { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`The local service responded with ${response.status}.`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('The local service returned an unexpected response.');
  return payload;
}

function readableLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceSummaries(payload: unknown): SourceSummary[] {
  const sources = isRecord(payload) ? payload.sources : Array.isArray(payload) ? payload : null;
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.displayName !== 'string' || typeof value.state !== 'string') return [];
    return [{ id: value.id, displayName: value.displayName, state: value.state, supportsBodies: value.supportsBodies === true, version: typeof value.version === 'string' ? value.version : 'unknown' }];
  });
}

function extractMetrics(dashboard: JsonRecord): Metric[] {
  const containers = [dashboard.metrics, dashboard.summary, dashboard.counts, dashboard.data, dashboard];
  const unique = new Map<string, Metric>();
  for (const container of containers) {
    if (!isRecord(container)) continue;
    for (const [key, value] of Object.entries(container)) {
      if (privateField.test(key) || ignoredMetricField.test(key)) continue;
      const display = typeof value === 'number' ? new Intl.NumberFormat().format(value) : typeof value === 'string' && value.length <= 48 ? value : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : null;
      if (display !== null && !unique.has(key)) unique.set(key, { label: readableLabel(key), value: display });
    }
  }
  return [...unique.values()].slice(0, 4);
}

function healthLabel(health: JsonRecord): string {
  const value = health.status ?? health.health ?? health.ok;
  if (value === true || value === 'ok' || value === 'healthy' || value === 'ready') return 'Local service ready';
  return typeof value === 'string' ? readableLabel(value) : 'Local service connected';
}

function StatePanel({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <section className="state-panel" aria-labelledby="state-title"><div className="state-indicator" aria-hidden="true" /><div><h2 id="state-title">{title}</h2><p>{detail}</p>{children}</div></section>;
}

export function App() {
  const bridge = window.myWorkbench?.sources;
  const [runtime, setRuntime] = useState<RuntimeState>(initialState);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [scope, setScope] = useState<ContentScope>('metadata');
  const [selectionHandle, setSelectionHandle] = useState<string | null>(null);
  const [preview, setPreview] = useState<JsonRecord | null>(null);
  const [operation, setOperation] = useState<OperationState>({ busy: null, message: null, error: null });
  const [projectSelection, setProjectSelection] = useState<ProjectSelection | null>(null);
  const [projectRefreshKey, setProjectRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>('overview');

  const load = useCallback(async (signal?: AbortSignal) => {
    setRuntime((current) => ({ ...current, health: { status: 'loading', data: null, error: null }, dashboard: { status: 'loading', data: null, error: null }, sources: { status: 'loading', data: null, error: null } }));
    const activeSignal = signal ?? new AbortController().signal;
    const sourceRequest = bridge
      ? bridge.list().then((result) => {
          if (!result.ok) throw new Error(result.error ?? 'Source inventory request failed.');
          return sourceSummaries(result.sources ?? []);
        })
      : getJson('/api/sources', activeSignal).then(sourceSummaries);
    const [healthResult, dashboardResult, sourcesResult] = await Promise.allSettled([getJson('/health', activeSignal), getJson('/api/dashboard', activeSignal), sourceRequest]);
    if (signal?.aborted) return;
    setRuntime({
      health: healthResult.status === 'fulfilled' ? { status: 'ready', data: healthResult.value, error: null } : { status: 'error', data: null, error: healthResult.reason instanceof Error ? healthResult.reason.message : 'Health check failed.' },
      dashboard: dashboardResult.status === 'fulfilled' ? { status: 'ready', data: dashboardResult.value, error: null } : { status: 'error', data: null, error: dashboardResult.reason instanceof Error ? dashboardResult.reason.message : 'Dashboard request failed.' },
      sources: sourcesResult.status === 'fulfilled' ? { status: 'ready', data: sourcesResult.value, error: null } : { status: 'error', data: null, error: sourcesResult.reason instanceof Error ? sourcesResult.reason.message : 'Sources request failed.' },
      refreshedAt: new Date(),
    });
  }, [bridge]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  useEffect(() => {
    if (activeView !== 'overview') setProjectSelection(null);
  }, [activeView]);

  const refresh = useCallback(async () => { setRefreshing(true); try { await load(); setProjectRefreshKey((key) => key + 1); } finally { setRefreshing(false); } }, [load]);
  const sources = runtime.sources.status === 'ready' && runtime.sources.data ? runtime.sources.data : [];
  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;
  const metrics = useMemo(() => runtime.dashboard.status === 'ready' && runtime.dashboard.data ? extractMetrics(runtime.dashboard.data) : [], [runtime.dashboard]);
  const observedData = metrics.some((metric) => metric.value !== '0');
  const loading = runtime.health.status === 'loading' || runtime.dashboard.status === 'loading';
  const hasError = runtime.health.status === 'error' || runtime.dashboard.status === 'error';

  const openSource = (source: SourceSummary) => {
    setSelectedSourceId(source.id);
    setScope('metadata');
    setSelectionHandle(null);
    setPreview(null);
    setOperation({ busy: null, message: null, error: null });
  };

  const run = async (name: string, action: () => Promise<{ ok: boolean; error?: string; value?: unknown; selectionHandle?: string; cancelled?: boolean }>, onSuccess?: (result: { value?: unknown; selectionHandle?: string; cancelled?: boolean }) => void) => {
    setOperation({ busy: name, message: null, error: null });
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error ?? 'The operation could not be completed.');
      onSuccess?.(result);
      setOperation({ busy: null, message: `${readableLabel(name)} completed.`, error: null });
      await load();
      setProjectRefreshKey((key) => key + 1);
    } catch (error) {
      setOperation({ busy: null, message: null, error: error instanceof Error ? error.message : 'The operation could not be completed.' });
    }
  };

  const chooseDirectory = () => {
    if (!bridge || !selectedSource) return;
    void run('choose directory', () => bridge.chooseDirectory(selectedSource.id), (result) => {
      if (result.cancelled) setOperation({ busy: null, message: 'Folder selection cancelled.', error: null });
      else if (result.selectionHandle) { setSelectionHandle(result.selectionHandle); setPreview(null); }
    });
  };

  const previewSelection = () => {
    if (!bridge || !selectedSource || !selectionHandle) return;
    void run('preview', () => bridge.previewSelection(selectedSource.id, selectionHandle, scope), (result) => setPreview(isRecord(result.value) ? result.value : null));
  };

  const grant = () => {
    if (!bridge || !selectedSource || !selectionHandle) return;
    void run('authorize', () => bridge.grant(selectedSource.id, selectionHandle, scope), () => setSelectionHandle(null));
  };

  const scan = () => { if (bridge && selectedSource) void run('scan', () => bridge.scan(selectedSource.id)); };
  const revoke = () => { if (bridge && selectedSource) void run('revoke', () => bridge.revoke(selectedSource.id)); };
  const deleteIndex = () => {
    if (!bridge || !selectedSource || !window.confirm(`Delete only the derived ${selectedSource.displayName} index? Original source files are not touched.`)) return;
    void run('delete index', () => bridge.deleteIndex(selectedSource.id));
  };

  return (
    <main className="cockpit-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="nav-pod" aria-label="Primary navigation">
        <div className="brand-mark" aria-hidden="true">MW</div>
        <nav>
          <button className={`nav-item ${activeView === 'overview' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('overview')} aria-current={activeView === 'overview' ? 'page' : undefined}><span aria-hidden="true">◉</span>Overview</button>
          <button className={`nav-item ${activeView === 'content' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('content')} aria-current={activeView === 'content' ? 'page' : undefined}><span aria-hidden="true">◌</span>Content</button>
          <button className={`nav-item ${activeView === 'quality' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('quality')} aria-current={activeView === 'quality' ? 'page' : undefined}><span aria-hidden="true">◇</span>Quality</button>
          <button className={`nav-item ${activeView === 'sources' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('sources')} aria-current={activeView === 'sources' ? 'page' : undefined}><span aria-hidden="true">◫</span>Sources</button>
        </nav>
        <p className="nav-footnote">Local-first<br />Read-only sources</p>
      </aside>

      <section id="workspace" className="workspace" aria-labelledby="page-title" tabIndex={-1}>
        <header className="workspace-header"><div><p className="eyebrow">{activeView === 'overview' ? 'Personal work evidence' : readableLabel(activeView)}</p><h1 id="page-title">MyWorkbench</h1></div><button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loading || refreshing}><span aria-hidden="true">↻</span>{refreshing ? 'Refreshing' : 'Refresh'}</button></header>
        <div className="sr-only" aria-live="polite" aria-atomic="true">{loading ? 'Loading local service and dashboard.' : hasError ? 'Some local data could not be loaded.' : operation.message ?? operation.error ?? 'Local dashboard updated.'}</div>
        {activeView === 'overview' ? <>
          {loading ? <StatePanel title="Loading local evidence" detail="Checking the local service and reading the dashboard." /> : hasError ? <StatePanel title="Local data is unavailable" detail="The shell could not load one or more local read endpoints."><button className="text-button" type="button" onClick={() => void refresh()}>Try again</button></StatePanel> : !observedData ? <StatePanel title="No indexed evidence yet" detail="The local service is connected, but the dashboard has no visible evidence. Authorize a source and run a scan to populate this view." /> : <section id="data-state" className="dashboard-content" aria-label="Dashboard data"><div className="section-heading"><div><p className="eyebrow">Observed dashboard data</p><h2>Current evidence</h2></div>{runtime.refreshedAt ? <time dateTime={runtime.refreshedAt.toISOString()}>Updated just now</time> : null}</div><div className="metrics-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><p>{metric.label}</p><strong>{metric.value}</strong></article>)}</div></section>}
          <ProjectRack refreshKey={projectRefreshKey} onSelectionChange={setProjectSelection} />
          <ActivityTimeline refreshKey={projectRefreshKey} />
        </> : null}
        {activeView === 'content' ? <ContentView refreshKey={projectRefreshKey} /> : null}
        {activeView === 'quality' ? <QualityView refreshKey={projectRefreshKey} /> : null}
        {activeView === 'sources' ? <section className="view-panel source-intro" aria-labelledby="source-intro-title"><p className="eyebrow">Source centre</p><h2 id="source-intro-title">Choose a source to inspect its read boundary</h2><p className="muted">The source list and authorization controls are shown below. Paths remain hidden from the page and are handled by the desktop bridge.</p></section> : null}
      </section>

      {activeView === 'sources' ? <section id="sources" className="source-centre" aria-labelledby="sources-title">
        <div className="section-heading"><div><p className="eyebrow">Source centre</p><h2 id="sources-title">Read permissions are separate</h2></div><p className="muted">No folders are scanned until explicitly authorized.</p></div>
        {runtime.sources.status === 'loading' ? <p className="muted">Loading supported sources…</p> : null}
        {runtime.sources.status === 'error' ? <p className="error-copy">The source inventory could not be loaded.</p> : null}
        {runtime.sources.status === 'ready' ? <ul className="source-grid" aria-label="Supported data sources">{sources.map((source) => <li key={source.id} className="source-row"><div><strong>{source.displayName}</strong><span>{source.supportsBodies ? 'Metadata by default · body requires separate permission' : 'Metadata only'}</span></div><div className="source-actions"><span className={`source-state source-state--${source.state}`}>{readableLabel(source.state)}</span><button type="button" className="source-manage" onClick={() => openSource(source)}>{source.state === 'unsupported' ? 'Details' : 'Manage'}</button></div></li>)}</ul> : null}

        {selectedSource ? <section className="source-control" aria-labelledby="source-control-title">
          <div><p className="eyebrow">Selected source</p><h3 id="source-control-title">{selectedSource.displayName}</h3><p className="muted">Adapter {selectedSource.version} · {readableLabel(selectedSource.state)}</p></div>
          {selectedSource.state === 'unsupported' ? <p className="error-copy">This adapter is not available in the current build. It cannot scan or request a folder.</p> : !bridge ? <p className="muted">Source controls require the MyWorkbench desktop shell. Browser development mode remains read-only.</p> : <div className="source-control-body">
            <fieldset disabled={operation.busy !== null}><legend>Permission scope</legend><label><input type="radio" name="scope" checked={scope === 'metadata'} onChange={() => setScope('metadata')} /> Metadata only</label>{selectedSource.supportsBodies ? <label><input type="radio" name="scope" checked={scope === 'metadata_and_body'} onChange={() => setScope('metadata_and_body')} /> Include this source’s body text</label> : null}</fieldset>
            <div className="control-actions"><button className="text-button" type="button" onClick={chooseDirectory} disabled={operation.busy !== null}>Choose folder</button>{selectionHandle ? <button className="text-button" type="button" onClick={previewSelection} disabled={operation.busy !== null}>Preview read</button> : null}{selectionHandle && preview ? <button className="text-button text-button--primary" type="button" onClick={grant} disabled={operation.busy !== null}>Authorize</button> : null}<button className="text-button" type="button" onClick={scan} disabled={operation.busy !== null || (selectedSource.state !== 'ready' && selectedSource.state !== 'partial')}>Scan</button><button className="text-button" type="button" onClick={revoke} disabled={operation.busy !== null || selectedSource.state === 'awaiting_authorization'}>Revoke</button><button className="text-button text-button--danger" type="button" onClick={deleteIndex} disabled={operation.busy !== null}>Delete derived index</button></div>
            {selectionHandle ? <p className="muted">A folder was selected in the native dialog. Its path is not shown or exposed to this page.</p> : null}
            {preview ? <dl className="preview-grid"><div><dt>Estimated records</dt><dd>{String(preview.estimatedRecords ?? 0)}</dd></div><div><dt>Earliest evidence</dt><dd>{typeof preview.earliest === 'string' ? new Date(preview.earliest).toLocaleString() : 'None'}</dd></div><div><dt>Latest evidence</dt><dd>{typeof preview.latest === 'string' ? new Date(preview.latest).toLocaleString() : 'None'}</dd></div></dl> : null}
            {operation.message ? <p className="operation-message" role="status">{operation.message}</p> : null}{operation.error ? <p className="error-copy" role="alert">{operation.error}</p> : null}
          </div>}
        </section> : null}
      </section> : null}

      <aside id="service-state" className="evidence-panel" aria-labelledby="service-title"><div className="panel-header"><p className="eyebrow">{projectSelection ? 'Selected evidence' : 'Runtime'}</p><span className={runtime.health.status === 'ready' ? 'health-dot health-dot--ready' : 'health-dot'} aria-hidden="true" /></div>{projectSelection ? <><h2 id="service-title">{projectSelection.project.name}</h2><p className="service-status">{projectSelection.project.eventCount} observed events · latest {new Date(projectSelection.project.lastActivity).toLocaleString()}</p><ol className="evidence-events">{projectSelection.events.length ? projectSelection.events.map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time><strong>{event.title}</strong><span>{readableLabel(event.sourceId)} · {readableLabel(event.type)}</span></li>) : <li className="muted">No directly linked event detail is available yet.</li>}</ol></> : <><h2 id="service-title">Local service</h2>{runtime.health.status === 'loading' ? <p className="muted">Checking health endpoint…</p> : null}{runtime.health.status === 'ready' && runtime.health.data ? <p className="service-status">{healthLabel(runtime.health.data)}</p> : null}{runtime.health.status === 'error' ? <p className="error-copy">{runtime.health.error}</p> : null}</>}<div className="privacy-note"><span aria-hidden="true">⌁</span><p>Desktop authorization uses a restricted native bridge. This page never receives control credentials or selected folder paths.</p></div><dl className="endpoint-list"><div><dt>Health</dt><dd>{runtime.health.status}</dd></div><div><dt>Dashboard</dt><dd>{runtime.dashboard.status}</dd></div><div><dt>Sources</dt><dd>{runtime.sources.status}</dd></div></dl></aside>
    </main>
  );
}
