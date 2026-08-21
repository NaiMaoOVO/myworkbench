import { useCallback, useEffect, useRef, useState } from 'react';

export interface ProjectCard {
  name: string;
  eventCount: number;
  lastActivity: string;
}

export interface EvidenceEvent {
  id: string;
  sourceId: string;
  occurredAt: string;
  type: string;
  title: string;
  workspace: string | null;
  factLevel: string;
}

export interface ProjectSelection {
  project: ProjectCard;
  events: EvidenceEvent[];
}

type ProjectRackProps = {
  refreshKey: number;
  onSelectionChange(selection: ProjectSelection | null): void;
};

type RackState = 'loading' | 'ready' | 'error';

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
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error('The local service returned an unexpected response.');
  return value;
}

function projectsFrom(value: Record<string, unknown>): ProjectCard[] {
  if (!Array.isArray(value.projects)) return [];
  return value.projects.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.eventCount !== 'number' || typeof item.lastActivity !== 'string') return [];
    return [{ name: item.name, eventCount: item.eventCount, lastActivity: item.lastActivity }];
  });
}

function eventsFrom(value: Record<string, unknown>): EvidenceEvent[] {
  if (!Array.isArray(value.events)) return [];
  return value.events.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sourceId !== 'string' || typeof item.occurredAt !== 'string' || typeof item.type !== 'string' || typeof item.title !== 'string') return [];
    return [{ id: item.id, sourceId: item.sourceId, occurredAt: item.occurredAt, type: item.type, title: item.title, workspace: typeof item.workspace === 'string' ? item.workspace : null, factLevel: typeof item.factLevel === 'string' ? item.factLevel : 'observed' }];
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown activity time' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ProjectRack({ refreshKey, onSelectionChange }: ProjectRackProps) {
  const [state, setState] = useState<RackState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [events, setEvents] = useState<EvidenceEvent[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [previousName, setPreviousName] = useState<string | null>(null);
  const dragStartX = useRef<number | null>(null);
  const rackRef = useRef<HTMLDivElement | null>(null);

  const select = useCallback((name: string) => {
    setSelectedName((current) => {
      if (current === name) return current;
      setPreviousName(current);
      return name;
    });
  }, []);

  const selectRelative = useCallback((delta: number) => {
    if (projects.length === 0) return;
    const currentIndex = Math.max(0, projects.findIndex((project) => project.name === selectedName));
    const nextIndex = Math.min(projects.length - 1, Math.max(0, currentIndex + delta));
    select(projects[nextIndex].name);
  }, [projects, selectedName, select]);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setError(null);
    Promise.all([readJson('/api/projects', controller.signal), readJson('/api/events', controller.signal)])
      .then(([projectPayload, eventPayload]) => {
        if (controller.signal.aborted) return;
        const nextProjects = projectsFrom(projectPayload);
        setProjects(nextProjects);
        setEvents(eventsFrom(eventPayload));
        setSelectedName((current) => nextProjects.some((project) => project.name === current) ? current : nextProjects.at(0)?.name ?? null);
        setState('ready');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setState('error');
          setError(reason instanceof Error ? reason.message : 'Project data could not be loaded.');
        }
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!previousName) return;
    const timer = window.setTimeout(() => setPreviousName(null), 380);
    return () => window.clearTimeout(timer);
  }, [previousName]);

  useEffect(() => {
    const node = rackRef.current;
    if (!node) return;
    // React attaches wheel listeners passively, which blocks preventDefault;
    // the rack needs a native non-passive listener to own wheel selection.
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 6 && Math.abs(event.deltaX) < 6) return;
      event.preventDefault();
      selectRelative(event.deltaY + event.deltaX > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [selectRelative]);

  useEffect(() => {
    const project = projects.find((item) => item.name === selectedName) ?? null;
    onSelectionChange(project ? { project, events: events.filter((event) => event.workspace === project.name).slice(0, 8) } : null);
  }, [events, onSelectionChange, projects, selectedName]);

  if (state === 'loading') return <section className="rack-state" aria-live="polite">Loading project evidence…</section>;
  if (state === 'error') return <section className="rack-state rack-state--error" role="alert">Project evidence is unavailable: {error}</section>;
  if (projects.length === 0) return null;

  return (
    <section className="project-rack-section" aria-labelledby="project-rack-title">
      <div className="section-heading">
        <div><p className="eyebrow">Evidence rack</p><h2 id="project-rack-title">Projects in motion</h2></div>
        <p className="muted">Use arrow keys, the wheel, drag, or select a file card.</p>
      </div>
      <div
        ref={rackRef}
        className="project-rack"
        role="listbox"
        aria-label="Project evidence rack"
        aria-activedescendant={selectedName ? `project-card-${selectedName}` : undefined}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); selectRelative(1); }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); selectRelative(-1); }
          if (event.key === 'Home') { event.preventDefault(); select(projects[0].name); }
          if (event.key === 'End') { event.preventDefault(); select(projects.at(-1)!.name); }
        }}
        onPointerDown={(event) => { dragStartX.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={(event) => {
          const start = dragStartX.current;
          dragStartX.current = null;
          if (start === null) return;
          const delta = event.clientX - start;
          if (Math.abs(delta) >= 32) selectRelative(delta < 0 ? 1 : -1);
        }}
      >
        <div className="rack-slots" aria-hidden="true" />
        {projects.slice(0, 8).map((project, index) => {
          const stateClass = project.name === selectedName ? 'project-card--current' : project.name === previousName ? 'project-card--previous' : 'project-card--slot';
          return <button
            id={`project-card-${project.name}`}
            key={project.name}
            type="button"
            role="option"
            aria-selected={project.name === selectedName}
            className={`project-card ${stateClass}`}
            style={{ '--slot': index } as React.CSSProperties}
            onClick={() => select(project.name)}
          >
            <span className="project-card__tab">{String(index + 1).padStart(2, '0')}</span>
            <span className="project-card__sheet"><small>{project.eventCount} evidence events</small><strong>{project.name}</strong><em>Last activity · {formatDate(project.lastActivity)}</em></span>
          </button>;
        })}
      </div>
    </section>
  );
}
