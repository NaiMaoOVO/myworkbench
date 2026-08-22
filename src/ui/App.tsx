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

const viewLabels: Record<ActiveView, string> = {
  overview: '总览',
  content: '内容',
  quality: '质量',
  sources: '来源中心',
};

const metricLabels: Record<string, string> = {
  eventCount: '事件数',
  projectCount: '项目数',
  dataState: '数据状态',
};

const metricValues: Record<string, Record<string, string>> = {
  dataState: { ready: '就绪', empty: '空' },
};

const stateLabels: Record<string, string> = {
  undiscovered: '未发现',
  awaiting_authorization: '待授权',
  ready: '就绪',
  scanning: '扫描中',
  partial: '部分成功',
  blocked: '受阻',
  unsupported: '不支持',
};

const operationLabels: Record<string, string> = {
  'choose directory': '选择目录',
  preview: '预览读取',
  authorize: '授权',
  scan: '扫描',
  revoke: '撤销授权',
  'delete index': '删除派生索引',
};

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
  if (!response.ok) throw new Error(`本地服务响应了 ${response.status}。`);
  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw new Error('本地服务返回了意外的响应格式。');
  return payload;
}

function readableLabel(value: string): string {
  return stateLabels[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
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
      let display: string | null = null;
      if (metricValues[key] && typeof value === 'string') display = metricValues[key][value] ?? value;
      else if (typeof value === 'number') display = new Intl.NumberFormat().format(value);
      else if (typeof value === 'string' && value.length <= 48) display = value;
      else if (typeof value === 'boolean') display = value ? '是' : '否';
      if (display !== null && !unique.has(key)) unique.set(key, { label: metricLabels[key] ?? readableLabel(key), value: display });
    }
  }
  return [...unique.values()].slice(0, 4);
}

function healthLabel(health: JsonRecord): string {
  const value = health.status ?? health.health ?? health.ok;
  if (value === true || value === 'ok' || value === 'healthy' || value === 'ready') return '本地服务就绪';
  return typeof value === 'string' ? readableLabel(value) : '本地服务已连接';
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
          if (!result.ok) throw new Error(result.error ?? '来源清单请求失败。');
          return sourceSummaries(result.sources ?? []);
        })
      : getJson('/api/sources', activeSignal).then(sourceSummaries);
    const [healthResult, dashboardResult, sourcesResult] = await Promise.allSettled([getJson('/health', activeSignal), getJson('/api/dashboard', activeSignal), sourceRequest]);
    if (signal?.aborted) return;
    setRuntime({
      health: healthResult.status === 'fulfilled' ? { status: 'ready', data: healthResult.value, error: null } : { status: 'error', data: null, error: healthResult.reason instanceof Error ? healthResult.reason.message : '健康检查失败。' },
      dashboard: dashboardResult.status === 'fulfilled' ? { status: 'ready', data: dashboardResult.value, error: null } : { status: 'error', data: null, error: dashboardResult.reason instanceof Error ? dashboardResult.reason.message : '仪表盘请求失败。' },
      sources: sourcesResult.status === 'fulfilled' ? { status: 'ready', data: sourcesResult.value, error: null } : { status: 'error', data: null, error: sourcesResult.reason instanceof Error ? sourcesResult.reason.message : '来源请求失败。' },
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
  const dashboardData = runtime.dashboard.status === 'ready' && runtime.dashboard.data ? runtime.dashboard.data : null;
  const observedData = dashboardData?.dataState === 'empty' ? false : metrics.some((metric) => metric.value !== '0');
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
      if (!result.ok) throw new Error(result.error ?? '操作未能完成。');
      onSuccess?.(result);
      setOperation({ busy: null, message: `${operationLabels[name] ?? name}已完成。`, error: null });
      await load();
      setProjectRefreshKey((key) => key + 1);
    } catch (error) {
      setOperation({ busy: null, message: null, error: error instanceof Error ? error.message : '操作未能完成。' });
    }
  };

  const chooseDirectory = () => {
    if (!bridge || !selectedSource) return;
    void run('choose directory', () => bridge.chooseDirectory(selectedSource.id), (result) => {
      if (result.cancelled) setOperation({ busy: null, message: '已取消选择文件夹。', error: null });
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
    if (!bridge || !selectedSource || !window.confirm(`仅删除 ${selectedSource.displayName} 的派生索引？原始来源文件不受影响。`)) return;
    void run('delete index', () => bridge.deleteIndex(selectedSource.id));
  };

  return (
    <main className="cockpit-shell">
      <a className="skip-link" href="#workspace">跳到工作区</a>
      <aside className="nav-pod" aria-label="主导航">
        <div className="brand-mark" aria-hidden="true">MW</div>
        <nav>
          <button className={`nav-item ${activeView === 'overview' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('overview')} aria-current={activeView === 'overview' ? 'page' : undefined}><span aria-hidden="true">◉</span>总览</button>
          <button className={`nav-item ${activeView === 'content' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('content')} aria-current={activeView === 'content' ? 'page' : undefined}><span aria-hidden="true">◌</span>内容</button>
          <button className={`nav-item ${activeView === 'quality' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('quality')} aria-current={activeView === 'quality' ? 'page' : undefined}><span aria-hidden="true">◇</span>质量</button>
          <button className={`nav-item ${activeView === 'sources' ? 'nav-item--active' : ''}`} type="button" onClick={() => setActiveView('sources')} aria-current={activeView === 'sources' ? 'page' : undefined}><span aria-hidden="true">◫</span>来源</button>
        </nav>
        <p className="nav-footnote">本地优先<br />来源只读</p>
      </aside>

      <section id="workspace" className="workspace" aria-labelledby="page-title" tabIndex={-1}>
        <header className="workspace-header"><div><p className="eyebrow">{activeView === 'overview' ? '个人工作证据' : viewLabels[activeView]}</p><h1 id="page-title">MyWorkbench 工作台</h1></div><button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loading || refreshing}><span aria-hidden="true">↻</span>{refreshing ? '刷新中…' : '刷新'}</button></header>
        <div className="sr-only" aria-live="polite" aria-atomic="true">{loading ? '正在加载本地服务与仪表盘。' : hasError ? '部分本地数据加载失败。' : operation.message ?? operation.error ?? '本地仪表盘已更新。'}</div>
        {activeView === 'overview' ? <>
          {loading ? <StatePanel title="正在加载本地证据" detail="正在检查本地服务并读取仪表盘。" /> : hasError ? <StatePanel title="本地数据不可用" detail="一个或多个本地只读端点加载失败。"><button className="text-button" type="button" onClick={() => void refresh()}>重试</button></StatePanel> : !observedData ? <StatePanel title="尚无已索引的证据" detail="本地服务已连接，但仪表盘暂无可见证据。请先授权一个来源并执行扫描，此视图便会填充。" /> : <section id="data-state" className="dashboard-content" aria-label="仪表盘数据"><div className="section-heading"><div><p className="eyebrow">观测到的仪表盘数据</p><h2>当前证据</h2></div>{runtime.refreshedAt ? <time dateTime={runtime.refreshedAt.toISOString()}>刚刚更新</time> : null}</div><div className="metrics-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><p>{metric.label}</p><strong>{metric.value}</strong></article>)}</div></section>}
          <ProjectRack refreshKey={projectRefreshKey} onSelectionChange={setProjectSelection} />
          <ActivityTimeline refreshKey={projectRefreshKey} />
        </> : null}
        {activeView === 'content' ? <ContentView refreshKey={projectRefreshKey} /> : null}
        {activeView === 'quality' ? <QualityView refreshKey={projectRefreshKey} /> : null}
        {activeView === 'sources' ? <section className="view-panel source-intro" aria-labelledby="source-intro-title"><p className="eyebrow">来源中心</p><h2 id="source-intro-title">选择一个来源以查看其读取边界</h2><p className="muted">下方展示来源列表与授权控件。路径不会暴露给页面，由桌面桥接处理。</p></section> : null}
      </section>

      {activeView === 'sources' ? <section id="sources" className="source-centre" aria-labelledby="sources-title">
        <div className="section-heading"><div><p className="eyebrow">来源中心</p><h2 id="sources-title">各来源的读取权限相互独立</h2></div><p className="muted">未明确授权前不会扫描任何文件夹。</p></div>
        {runtime.sources.status === 'loading' ? <p className="muted">正在加载支持的来源…</p> : null}
        {runtime.sources.status === 'error' ? <p className="error-copy">来源清单加载失败。</p> : null}
        {runtime.sources.status === 'ready' ? <ul className="source-grid" aria-label="支持的数据来源">{sources.map((source) => <li key={source.id} className="source-row"><div><strong>{source.displayName}</strong><span>{source.supportsBodies ? '默认仅元数据 · 正文需单独授权' : '仅元数据'}</span></div><div className="source-actions"><span className={`source-state source-state--${source.state}`}>{readableLabel(source.state)}</span><button type="button" className="source-manage" onClick={() => openSource(source)}>{source.state === 'unsupported' ? '详情' : '管理'}</button></div></li>)}</ul> : null}

        {selectedSource ? <section className="source-control" aria-labelledby="source-control-title">
          <div><p className="eyebrow">已选来源</p><h3 id="source-control-title">{selectedSource.displayName}</h3><p className="muted">适配器 {selectedSource.version} · {readableLabel(selectedSource.state)}</p></div>
          {selectedSource.state === 'unsupported' ? <p className="error-copy">当前构建中此适配器不可用，无法扫描或请求文件夹。</p> : !bridge ? <p className="muted">来源控制需要 MyWorkbench 桌面外壳；浏览器开发模式保持只读。</p> : <div className="source-control-body">
            <fieldset disabled={operation.busy !== null}><legend>权限范围</legend><label><input type="radio" name="scope" checked={scope === 'metadata'} onChange={() => setScope('metadata')} /> 仅元数据</label>{selectedSource.supportsBodies ? <label><input type="radio" name="scope" checked={scope === 'metadata_and_body'} onChange={() => setScope('metadata_and_body')} /> 包含此来源的正文文本</label> : null}</fieldset>
            <div className="control-actions"><button className="text-button" type="button" onClick={chooseDirectory} disabled={operation.busy !== null}>选择文件夹</button>{selectionHandle ? <button className="text-button" type="button" onClick={previewSelection} disabled={operation.busy !== null}>预览读取</button> : null}{selectionHandle && preview ? <button className="text-button text-button--primary" type="button" onClick={grant} disabled={operation.busy !== null}>授权</button> : null}<button className="text-button" type="button" onClick={scan} disabled={operation.busy !== null || (selectedSource.state !== 'ready' && selectedSource.state !== 'partial')}>扫描</button><button className="text-button" type="button" onClick={revoke} disabled={operation.busy !== null || selectedSource.state === 'awaiting_authorization'}>撤销授权</button><button className="text-button text-button--danger" type="button" onClick={deleteIndex} disabled={operation.busy !== null}>删除派生索引</button></div>
            {selectionHandle ? <p className="muted">已在原生对话框中选择文件夹。其路径不会显示或暴露给本页面。</p> : null}
            {preview ? <dl className="preview-grid"><div><dt>预计记录数</dt><dd>{String(preview.estimatedRecords ?? 0)}</dd></div><div><dt>最早证据</dt><dd>{typeof preview.earliest === 'string' ? new Date(preview.earliest).toLocaleString() : '无'}</dd></div><div><dt>最新证据</dt><dd>{typeof preview.latest === 'string' ? new Date(preview.latest).toLocaleString() : '无'}</dd></div></dl> : null}
            {operation.message ? <p className="operation-message" role="status">{operation.message}</p> : null}{operation.error ? <p className="error-copy" role="alert">{operation.error}</p> : null}
          </div>}
        </section> : null}
      </section> : null}

      <aside id="service-state" className="evidence-panel" aria-labelledby="service-title"><div className="panel-header"><p className="eyebrow">{projectSelection ? '已选证据' : '运行时'}</p><span className={runtime.health.status === 'ready' ? 'health-dot health-dot--ready' : 'health-dot'} aria-hidden="true" /></div>{projectSelection ? <><h2 id="service-title">{projectSelection.project.name}</h2><p className="service-status">{projectSelection.project.eventCount} 条观测事件 · 最近 {new Date(projectSelection.project.lastActivity).toLocaleString()}</p><ol className="evidence-events">{projectSelection.events.length ? projectSelection.events.map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time><strong>{event.title}</strong><span>{readableLabel(event.sourceId)} · {readableLabel(event.type)}</span></li>) : <li className="muted">暂无可用的直接关联事件详情。</li>}</ol></> : <><h2 id="service-title">本地服务</h2>{runtime.health.status === 'loading' ? <p className="muted">正在检查健康端点…</p> : null}{runtime.health.status === 'ready' && runtime.health.data ? <p className="service-status">{healthLabel(runtime.health.data)}</p> : null}{runtime.health.status === 'error' ? <p className="error-copy">{runtime.health.error}</p> : null}</>}<div className="privacy-note"><span aria-hidden="true">⌁</span><p>桌面授权使用受限的原生桥接。本页面永远不会收到控制凭据或所选文件夹的路径。</p></div><dl className="endpoint-list"><div><dt>健康检查</dt><dd>{runtime.health.status === 'ready' ? '就绪' : runtime.health.status === 'loading' ? '加载中' : '失败'}</dd></div><div><dt>仪表盘</dt><dd>{runtime.dashboard.status === 'ready' ? '就绪' : runtime.dashboard.status === 'loading' ? '加载中' : '失败'}</dd></div><div><dt>来源</dt><dd>{runtime.sources.status === 'ready' ? '就绪' : runtime.sources.status === 'loading' ? '加载中' : '失败'}</dd></div></dl></aside>
    </main>
  );
}
