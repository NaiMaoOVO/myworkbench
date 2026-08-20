import { useEffect, useMemo, useState } from 'react';

type TimelineEvent = { id: string; sourceId: string; occurredAt: string; type: string; title: string };

type Day = { key: string; label: string; count: number };

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
  if (!isRecord(payload)) throw new Error('The local service returned an unexpected response.');
  return payload;
}

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
    return { key, label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), count: counts.get(key) ?? 0 };
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
  if (state === 'loading') return <section className="timeline-panel" aria-live="polite">Loading observed activity…</section>;
  if (state === 'error' || events.length === 0) return null;

  return <section className="timeline-panel" aria-labelledby="timeline-title">
    <div className="section-heading"><div><p className="eyebrow">Activity track</p><h2 id="timeline-title">Observed event rhythm</h2></div><p className="muted">Select a date to inspect source evidence.</p></div>
    <div className="heatmap-strip" role="list" aria-label="Fourteen-day activity timeline">
      {days.map((day) => <button key={day.key} type="button" role="listitem" className={`heatmap-day heatmap-day--${Math.min(3, day.count)} ${day.key === selectedDay ? 'heatmap-day--selected' : ''}`} onClick={() => setSelectedDay(day.key)} aria-pressed={day.key === selectedDay} aria-label={`${day.label}: ${day.count} observed events`}><span>{day.label}</span><b>{day.count}</b></button>)}
    </div>
    <ol className="timeline-events" aria-live="polite">
      {selectedEvents.length ? selectedEvents.slice(0, 4).map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><strong>{event.title}</strong><span>{label(event.sourceId)} · {label(event.type)}</span></li>) : <li className="muted">No observed events on this date.</li>}
    </ol>
  </section>;
}
