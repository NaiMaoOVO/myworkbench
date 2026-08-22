import { useEffect, useMemo, useState } from 'react';
import { isRecord, readJson } from './api';

type TimelineEvent = { id: string; sourceId: string; occurredAt: string; type: string; title: string };

type Day = { key: string; label: string; count: number };

function eventList(payload: Record<string, unknown>): TimelineEvent[] {
  if (!Array.isArray(payload.events)) return [];
  return payload.events.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string' || typeof item.occurredAt !== 'string' || typeof item.type !== 'string' || typeof item.title !== 'string') return [];
    return [{ id: item.id, sourceId: item.sourceId, occurredAt: item.occurredAt, type: item.type, title: item.title }];
  });
}

function dateKey(value: string): string {
  return new Date(value).toLocaleDateString('en-CA');
}

function buildDays(events: TimelineEvent[]): Day[] {
  const anchor = events.at(0) ? new Date(events[0].occurredAt) : new Date();
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = dateKey(event.occurredAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(anchor);
    date.setDate(date.getDate() - (13 - offset));
    const key = date.toLocaleDateString('en-CA');
    return { key, label: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }), count: counts.get(key) ?? 0 };
  });
}

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ActivityTimeline({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    Promise.all([readJson('/api/heatmap', controller.signal), readJson('/api/events', controller.signal)])
      .then(([, eventPayload]) => {
        if (controller.signal.aborted) return;
        const next = eventList(eventPayload);
        setEvents(next);
        setSelectedDay(next.at(0) ? dateKey(next[0].occurredAt) : null);
        setState('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [refreshKey]);

  const days = useMemo(() => buildDays(events), [events]);
  const selectedEvents = selectedDay ? events.filter((event) => dateKey(event.occurredAt) === selectedDay) : [];
  if (state === 'loading') return <section className="timeline-panel" aria-live="polite">正在加载观测活动…</section>;
  if (state === 'error' || events.length === 0) return null;

  return <section className="timeline-panel" aria-labelledby="timeline-title">
    <div className="section-heading"><div><p className="eyebrow">活动轨迹</p><h2 id="timeline-title">观测事件节奏</h2></div><p className="muted">选择日期查看当天的来源证据。</p></div>
    <div className="heatmap-strip" role="list" aria-label="十四天活动时间线">
      {days.map((day) => <button key={day.key} type="button" role="listitem" className={`heatmap-day heatmap-day--${Math.min(3, day.count)} ${day.key === selectedDay ? 'heatmap-day--selected' : ''}`} onClick={() => setSelectedDay(day.key)} aria-pressed={day.key === selectedDay} aria-label={`${day.label}：${day.count} 条观测事件`}><span>{day.label}</span><b>{day.count}</b></button>)}
    </div>
    <ol className="timeline-events" aria-live="polite">
      {selectedEvents.length ? selectedEvents.slice(0, 4).map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><strong>{event.title}</strong><span>{label(event.sourceId)} · {label(event.type)}</span></li>) : <li className="muted">该日期暂无观测事件。</li>}
    </ol>
  </section>;
}
