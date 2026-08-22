import { useEffect, useState } from 'react';
import { isRecord, readJson } from './api';

type ContentItem = {
  id: string;
  sourceId: string;
  occurredAt: string;
  title: string;
  body?: string;
  permission?: string;
};

function apiBaseUrl(): string {
  const candidate = new URL(window.location.href).searchParams.get('apiOrigin') ?? '';
  try {
    const parsed = new URL(candidate);
    return ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname) ? parsed.origin : window.location.origin;
  } catch {
    return 'http://127.0.0.1:8788';
  }
}

async function readContent(query: string, signal: AbortSignal): Promise<ContentItem[]> {
  const url = new URL('/api/content', apiBaseUrl());
  if (query) url.searchParams.set('q', query);
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`本地服务响应了 ${response.status}。`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.content)) throw new Error('内容端点返回了意外的响应格式。');
  return payload.content.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.occurredAt !== 'string' || typeof value.title !== 'string') return [];
    return [{
      id: value.id,
      sourceId: value.sourceId,
      occurredAt: value.occurredAt,
      title: value.title,
      body: typeof value.body === 'string' ? value.body : undefined,
      permission: typeof value.permission === 'string' ? value.permission : 'metadata_only',
    }];
  });
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN');
}

export function ContentView({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState('loading');
      readContent(query.trim(), controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          setItems(next);
          setState('ready');
        })
        .catch(() => {
          if (!controller.signal.aborted) setState('error');
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, refreshKey]);

  return (
    <section className="view-panel content-view" aria-labelledby="content-view-title">
      <div className="view-heading">
        <div>
          <p className="eyebrow">内容轨迹</p>
          <h2 id="content-view-title">已索引的内容元数据</h2>
        </div>
        <label className="search-field">
          <span className="sr-only">搜索已索引内容</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、来源或已授权正文" type="search" />
        </label>
      </div>
      {state === 'loading' ? <p className="muted">正在加载内容元数据…</p> : null}
      {state === 'error' ? <p className="error-copy">内容元数据不可用。请检查本地服务后重试。</p> : null}
      {state === 'ready' && items.length === 0 ? <p className="muted">{query ? '没有匹配的结果。' : '当前视图没有匹配的已授权内容元数据。'}</p> : null}
      {state === 'ready' && items.length > 0 ? (
        <ol className="content-list">
          {items.slice(0, 100).map((item) => (
            <li key={item.id} className="content-row">
              <time dateTime={item.occurredAt}>{displayDate(item.occurredAt)}</time>
              <div>
                <strong>{item.title}</strong>
                {item.body ? <p className="muted content-snippet">{item.body.slice(0, 200)}{item.body.length > 200 ? '…' : ''}</p> : null}
                <span>{item.sourceId} · {item.permission === 'body_authorized' ? '含已授权正文' : '仅元数据'}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
