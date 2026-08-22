import { useEffect, useState } from 'react';
import { isRecord, readJson } from './api';

export type TimelineEvent = { id: string; sourceId: string; occurredAt: string; type: string; title: string };
export type DailyCount = { day: string; count: number };

export function eventList(payload: Record<string, unknown>): TimelineEvent[] {
  if (!Array.isArray(payload.events)) return [];
  return payload.events.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string' || typeof item.occurredAt !== 'string' || typeof item.type !== 'string' || typeof item.title !== 'string') return [];
    return [{ id: item.id, sourceId: item.sourceId, occurredAt: item.occurredAt, type: item.type, title: item.title }];
  });
}

export function dateKey(value: string): string {
  return new Date(value).toLocaleDateString('en-CA');
}

/** 热力图与事件列表的共享数据源；dailyCounts 来自服务端 SQL 聚合。 */
export function useTimelineData(refreshKey: number) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    Promise.all([readJson('/api/heatmap', controller.signal), readJson('/api/events', controller.signal)])
      .then(([heatmapPayload, eventPayload]) => {
        if (controller.signal.aborted) return;
        const daily: DailyCount[] = Array.isArray(heatmapPayload.dailyCounts)
          ? heatmapPayload.dailyCounts.flatMap((row) => (isRecord(row) && typeof row.day === 'string' && typeof row.count === 'number' ? [{ day: row.day, count: row.count }] : []))
          : [];
        setDailyCounts(daily);
        const next = eventList(eventPayload);
        setEvents(next);
        setSelectedDay(next.at(0) ? dateKey(next[0].occurredAt) : null);
        setState('ready');
      })
      .catch(() => { if (!controller.signal.aborted) setState('error'); });
    return () => controller.abort();
  }, [refreshKey]);

  return { events, dailyCounts, selectedDay, setSelectedDay, state };
}
