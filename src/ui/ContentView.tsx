import { useEffect, useMemo, useState } from 'react';

type ContentItem = {
  id: string;
  sourceId: string;
  occurredAt: string;
  title: string;
};

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

async function readContent(signal: AbortSignal): Promise<ContentItem[]> {
  const response = await fetch(new URL('/api/content', apiBaseUrl()), { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`The local service responded with ${response.status}.`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.content)) throw new Error('The content endpoint returned an unexpected response.');
  return payload.content.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sourceId !== 'string' || typeof value.occurredAt !== 'string' || typeof value.title !== 'string') return [];
    return [{ id: value.id, sourceId: value.sourceId, occurredAt: value.occurredAt, title: value.title }];
  });
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown time' : date.toLocaleString();
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
          <p className="eyebrow">Content trail</p>
          <h2 id="content-view-title">Indexed content metadata</h2>
        </div>
        <label className="search-field">
          <span className="sr-only">Search indexed content</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or source" type="search" />
        </label>
      </div>
      {state === 'loading' ? <p className="muted">Loading content metadata…</p> : null}
      {state === 'error' ? <p className="error-copy">Content metadata is unavailable. Check the local service and try again.</p> : null}
      {state === 'ready' && filtered.length === 0 ? <p className="muted">No authorized content metadata matches this view.</p> : null}
      {state === 'ready' && filtered.length > 0 ? (
        <ol className="content-list">
          {filtered.slice(0, 100).map((item) => (
            <li key={item.id} className="content-row">
              <time dateTime={item.occurredAt}>{displayDate(item.occurredAt)}</time>
              <div>
                <strong>{item.title}</strong>
                <span>{item.sourceId} · metadata only</span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
