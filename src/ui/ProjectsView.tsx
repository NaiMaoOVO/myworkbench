import { useEffect, useMemo, useState } from 'react';
import { isRecord, readJson } from './api';

type ProjectRow = { name: string; eventCount: number; lastActivity: string };
type EventRow = { id: string; sourceId: string; occurredAt: string; title: string };

type Lifecycle = 'active' | 'review' | 'archived';

const lifecycleLabels: Record<Lifecycle, string> = {
  active: '活跃',
  review: '待复核',
  archived: '归档',
};

// 规则推断（非事实）：活跃 = 14 天内有事件；待复核 = 15–60 天；归档 = 超过 60 天。
function lifecycleFor(lastActivity: string, now: number): Lifecycle {
  const days = (now - new Date(lastActivity).getTime()) / 86400000;
  if (days <= 14) return 'active';
  if (days <= 60) return 'review';
  return 'archived';
}

function sourceGroup(sourceId: string): string {
  if (sourceId === 'git') return '代码提交';
  if (sourceId === 'obsidian' || sourceId === 'exports-compat') return '知识笔记';
  return 'AI 会话';
}

export function ProjectsView({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<Lifecycle | 'all'>('all');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    Promise.all([readJson('/api/projects', controller.signal), readJson('/api/events', controller.signal)])
      .then(([projectPayload, eventPayload]) => {
        if (controller.signal.aborted) return;
        const rows: ProjectRow[] = Array.isArray(projectPayload.projects)
          ? projectPayload.projects.flatMap((item: unknown) => {
              if (!isRecord(item) || typeof item.name !== 'string' || typeof item.eventCount !== 'number' || typeof item.lastActivity !== 'string') return [];
              return [{ name: item.name, eventCount: item.eventCount, lastActivity: item.lastActivity }];
            })
          : [];
        const evs: EventRow[] = Array.isArray(eventPayload.events)
          ? eventPayload.events.flatMap((item: unknown) => {
              if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string' || typeof item.occurredAt !== 'string' || typeof item.title !== 'string') return [];
              return [{ id: item.id, sourceId: item.sourceId, occurredAt: item.occurredAt, title: item.title }];
            })
          : [];
        setProjects(rows);
        setEvents(evs);
        setState('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [refreshKey]);

  const now = Date.now();
  const distribution = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const event of events) {
      const project = projects.find((p) => p.name === event.title)?.name;
      void project;
      const bucket = map.get(event.sourceId) ?? new Map<string, number>();
      bucket.set('count', (bucket.get('count') ?? 0) + 1);
      map.set(event.sourceId, bucket);
    }
    return [...map.entries()].map(([sourceId, bucket]) => ({ sourceId, count: bucket.get('count') ?? 0 })).sort((a, b) => b.count - a.count);
  }, [events, projects]);

  const filtered = projects
    .map((project) => ({ ...project, lifecycle: lifecycleFor(project.lastActivity, now) }))
    .filter((project) => filter === 'all' || project.lifecycle === filter)
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  return (
    <section className="view-panel projects-view" aria-labelledby="projects-view-title">
      <div className="view-heading">
        <div><p className="eyebrow">项目全景</p><h2 id="projects-view-title">项目生命周期</h2></div>
        <div className="lifecycle-filters" role="group" aria-label="生命周期筛选">
          {(['all', 'active', 'review', 'archived'] as const).map((key) => (
            <button key={key} type="button" className={`text-button ${filter === key ? 'text-button--primary' : ''}`} onClick={() => setFilter(key)}>
              {key === 'all' ? '全部' : lifecycleLabels[key]}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">生命周期为规则推断（活跃 ≤14 天、待复核 15–60 天、归档 &gt;60 天），可在证据详情中人工复核，不作为事实结论。</p>
      {state === 'loading' ? <p className="muted">正在加载项目…</p> : null}
      {state === 'error' ? <p className="error-copy">项目数据不可用。请检查本地服务后重试。</p> : null}
      {state === 'ready' && filtered.length === 0 ? <p className="muted">当前筛选下没有项目。</p> : null}
      {filtered.length > 0 ? (
        <ul className="project-list">
          {filtered.map((project) => (
            <li key={project.name} className="project-row">
              <div><strong>{project.name}</strong><span className="muted">{project.eventCount} 条事件 · 最近 {new Date(project.lastActivity).toLocaleString('zh-CN')}</span></div>
              <span className={`scan-status scan-status--${project.lifecycle}`}>{lifecycleLabels[project.lifecycle]}（规则推断）</span>
            </li>
          ))}
        </ul>
      ) : null}
      {distribution.length > 0 ? (
        <div className="quality-section">
          <h3>来源分布</h3>
          <ul className="scan-list">
            {distribution.map((entry) => <li key={entry.sourceId}><strong>{entry.sourceId}</strong><span>{entry.count} 条事件</span></li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
