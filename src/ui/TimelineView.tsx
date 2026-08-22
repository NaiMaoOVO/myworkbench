import { useTimelineData, dateKey } from './timeline-data';

function label(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/** PRD 信息架构的独立时间线页：热力图 + 当日全部跨源事件序列。 */
export function TimelineView({ refreshKey }: { refreshKey: number }) {
  const { events, dailyCounts, selectedDay, setSelectedDay, state } = useTimelineData(refreshKey);

  const counts = new Map(dailyCounts.map((row) => [row.day, row.count]));
  const days: Array<{ key: string; label: string; count: number }> = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000);
    const key = date.toLocaleDateString('en-CA');
    days.push({ key, label: date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }), count: counts.get(key) ?? 0 });
  }

  const dayEvents = selectedDay
    ? events.filter((event) => dateKey(event.occurredAt) === selectedDay).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    : [];
  const daySources = new Set(dayEvents.map((event) => event.sourceId));

  return (
    <section className="view-panel timeline-view" aria-labelledby="timeline-view-title">
      <div className="view-heading">
        <div><p className="eyebrow">时间线</p><h2 id="timeline-view-title">跨源事件序列</h2></div>
        <p className="muted">最近 30 天节奏 · 选择日期下钻当天完整事件序列，时间按系统时区显示。</p>
      </div>

      {state === 'loading' ? <p className="muted">正在加载时间线…</p> : null}
      {state === 'error' ? <p className="error-copy">时间线数据不可用。请检查本地服务后重试。</p> : null}

      {state === 'ready' ? <>
        <div className="heatmap-strip heatmap-strip--wide" role="list" aria-label="三十天活动热力图">
          {days.map((day) => (
            <button key={day.key} type="button" role="listitem" className={`heatmap-day ${day.key === selectedDay ? 'heatmap-day--selected' : ''}`} onClick={() => setSelectedDay(day.key)} aria-pressed={day.key === selectedDay} aria-label={`${day.label}：${day.count} 条观测事件`}>
              <span>{day.label}</span><b>{day.count}</b>
            </button>
          ))}
        </div>

        {selectedDay ? (
          <div className="timeline-day-detail">
            <h3>{new Date(selectedDay).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</h3>
            <p className="muted">当日 {dayEvents.length} 条事件 · 来自 {daySources.size} 个来源</p>
            {dayEvents.length === 0 ? <p className="muted">该日期暂无观测事件。</p> : (
              <ol className="timeline-events timeline-events--full">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time>
                    <strong>{event.title}</strong>
                    <span>{label(event.sourceId)} · {label(event.type)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : <p className="muted">选择上方日期查看当天的事件序列。</p>}
      </> : null}
    </section>
  );
}
