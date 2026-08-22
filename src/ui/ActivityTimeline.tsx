import { useTimelineData, dateKey } from './timeline-data';

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function ActivityTimeline({ refreshKey }: { refreshKey: number }) {
  const { events, dailyCounts, selectedDay, setSelectedDay, state } = useTimelineData(refreshKey);

  const counts = new Map(dailyCounts.map((row) => [row.day, row.count]));
  const days: Array<{ key: string; label: string; count: number }> = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000);
    const key = date.toLocaleDateString('en-CA');
    days.push({ key, label: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }), count: counts.get(key) ?? 0 });
  }

  if (state === 'loading') return <section className="timeline-panel" aria-live="polite">正在加载观测活动…</section>;
  if (state === 'error' || events.length === 0) return null;

  const selectedEvents = selectedDay ? events.filter((event) => dateKey(event.occurredAt) === selectedDay) : [];

  return <section className="timeline-panel" aria-labelledby="timeline-title">
    <div className="section-heading"><div><p className="eyebrow">活动轨迹</p><h2 id="timeline-title">观测事件节奏</h2></div><p className="muted">选择日期查看当天的来源证据。</p></div>
    <div className="heatmap-strip" role="list" aria-label="十四天活动时间线">
      {days.map((day) => <button key={day.key} type="button" role="listitem" className={`heatmap-day heatmap-day--${Math.min(3, day.count)} ${day.key === selectedDay ? 'heatmap-day--selected' : ''}`} onClick={() => setSelectedDay(day.key)} aria-pressed={day.key === selectedDay} aria-label={`${day.label}：${day.count} 条观测事件`}><span>{day.label}</span><b>{day.count}</b></button>)}
    </div>
    <ol className="timeline-events" aria-live="polite">
      {selectedEvents.length ? selectedEvents.slice(0, 4).map((event) => <li key={event.id}><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><strong>{event.title}</strong><span>{label(event.sourceId)} · {label(event.type)}</span></li>) : <li className="muted">该日期暂无观测事件。</li>}
    </ol>
  </section>;
}
