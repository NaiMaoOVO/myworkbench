import { useEffect, useMemo, useState } from 'react';
import { isRecord, readJson } from './api';

type ContentItem = {
  id: string;
  sourceId: string;
  occurredAt: string;
  title: string;
};

async function readContent(signal: AbortSignal): Promise<ContentItem[]> {
  const payload = await readJson('/api/content', signal);
  if (!Array.isArray(payload.content)) throw new Error('内容端点返回了意外的响应格式。');
  return payload.content.flatMap((value: unknown) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.occurredAt !== 'string' || typeof value.title !== 'string') return [];
    return [{ id: value.id, sourceId: value.sourceId, occurredAt: value.occurredAt, title: value.title }];
  });
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString();
}

export function ContentView({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    readContent(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setItems(next);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) => `${item.title} ${item.sourceId} ${item.occurredAt}`.toLocaleLowerCase().includes(normalized));
  }, [items, query]);

  return (
    <section className="view-panel content-view" aria-labelledby="content-view-title">
      <div className="view-heading">
        <div>
          <p className="eyebrow">内容轨迹</p>
          <h2 id="content-view-title">已索引的内容元数据</h2>
        </div>
        <label className="search-field">
          <span className="sr-only">搜索已索引内容</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或来源" type="search" />
        </label>
      </div>
      {state === 'loading' ? <p className="muted">正在加载内容元数据…</p> : null}
      {state === 'error' ? <p className="error-copy">内容元数据不可用。请检查本地服务后重试。</p> : null}
      {state === 'ready' && filtered.length === 0 ? <p className="muted">当前视图没有匹配的已授权内容元数据。</p> : null}
      {state === 'ready' && filtered.length > 0 ? (
        <ol className="content-list">
          {filtered.slice(0, 100).map((item) => (
            <li key={item.id} className="content-row">
              <time dateTime={item.occurredAt}>{displayDate(item.occurredAt)}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.sourceId} · 仅元数据</span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
