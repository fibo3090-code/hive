import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { eventStreamUrl } from '@/api/client';

/**
 * Map of backend SSE event names to the `QueryKey` prefixes that should
 * be invalidated when one fires. Each handler optionally drills down via
 * the event payload — e.g. `agent.spawned` only invalidates the lineage
 * of the parent it actually spawned under, not every agent in the
 * project.
 *
 * The payload type is `unknown` because we don't trust the wire shape;
 * each handler narrows safely with `getString` / optional chaining.
 */
type Invalidator = (payload: unknown) => readonly QueryKey[];

function getString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

const HANDLERS: Record<string, Invalidator> = {
  // Project-level scope. `projects` alone is broader than ideal but
  // necessary because the active-project query keys vary per consumer.
  'project.updated': () => [['projects'], ['projects', 'active'], ['settings']],

  // Agent lifecycle. Status events scope to the project; spawn events
  // scope to the parent's lineage subtree as well.
  'agent.status': (p) => {
    const projectId = getString(p, 'projectId');
    const agentId = getString(p, 'agentId');
    return [
      projectId ? ['agents', projectId] : ['agents'],
      agentId ? ['agent-messages', agentId] : ['agent-messages'],
      agentId ? ['agent-lineage', agentId] : ['agent-lineage'],
    ];
  },
  'agent.spawned': (p) => {
    const projectId = getString(p, 'projectId');
    const parentId = getString(p, 'parentId');
    return [
      projectId ? ['agents', projectId] : ['agents'],
      projectId ? ['wires', projectId] : ['wires'],
      parentId ? ['agent-lineage', parentId] : ['agent-lineage'],
    ];
  },
  'wire.changed': (p) => {
    const projectId = getString(p, 'projectId');
    return [projectId ? ['wires', projectId] : ['wires']];
  },

  'task.status': (p) => {
    const projectId = getString(p, 'projectId');
    return [
      projectId ? ['tasks', projectId] : ['tasks'],
      projectId ? ['insights', 'task-distribution', projectId] : ['insights', 'task-distribution'],
    ];
  },

  'alert.created': () => [['alerts']],
  'alert.dismissed': () => [['alerts']],
  'notification.created': () => [['notifications']],

  // W3-B5: drift auto-detection fires this after each agent turn whose
  // score crosses the record threshold. Invalidates both the open and
  // all-events drift query caches plus alerts/notifications because the
  // high-severity path also writes those.
  'drift.detected': (p) => {
    const projectId = getString(p, 'projectId');
    return [
      ['drift-events', projectId ?? '_none', 'open'],
      ['drift-events', projectId ?? '_none', 'all'],
      ['alerts'],
      ['notifications'],
    ];
  },

  'session.toggled': () => [['session'], ['projects']],
  'session.closed': () => [['session'], ['session-history']],

  'cost.ingested': (p) => {
    const projectId = getString(p, 'projectId');
    return [
      ['projects'],
      ['spend-timeline'],
      projectId ? ['insights', 'cost-timeline', projectId] : ['insights', 'cost-timeline'],
      projectId ? ['insights', 'agent-token-usage', projectId] : ['insights', 'agent-token-usage'],
    ];
  },

  'module.installed': () => [['modules'], ['module']],
  'module.published': (p) => {
    const jobId = getString(p, 'jobId');
    return [
      ['modules'],
      ['modules', 'published', 'all'],
      ['modules', 'published', 'project'],
      ['modules', 'published', 'public'],
      jobId ? ['synthesis-job', jobId] : ['synthesis-job'],
    ];
  },
  'module.unpublished': (p) => {
    const jobId = getString(p, 'jobId');
    return [
      ['modules'],
      ['modules', 'published', 'all'],
      ['modules', 'published', 'project'],
      ['modules', 'published', 'public'],
      jobId ? ['synthesis-job', jobId] : ['synthesis-job'],
    ];
  },

  'llm_provider.updated': (p) => {
    const id = getString(p, 'id');
    return [
      ['llm-providers'],
      id ? ['llm-providers', id, 'models'] : ['llm-providers'],
    ];
  },
  'llm_provider.tested': (p) => {
    const id = getString(p, 'id');
    return [
      ['llm-providers'],
      id ? ['llm-providers', id, 'models'] : ['llm-providers'],
    ];
  },

  'workspace.updated': (p) => {
    const projectId = getString(p, 'projectId');
    return [projectId ? ['workspace-info', projectId] : ['workspace-info']];
  },

  'chat.thread.created': (p) => {
    const projectId = getString(p, 'projectId');
    return [projectId ? ['chat-threads', projectId] : ['chat-threads']];
  },

  // Git events scope to the project so other projects' caches don't
  // refetch on every commit.
  'git.changed': (p) => {
    const projectId = getString(p, 'projectId');
    if (projectId) {
      return [
        ['git-status', projectId],
        ['git-branches', projectId],
        ['git-log', projectId],
        ['git-tree', projectId],
        ['git-diff', projectId],
        ['git-file', projectId],
      ];
    }
    return [['git-status'], ['git-branches'], ['git-log'], ['git-tree'], ['git-diff'], ['git-file']];
  },

  'synthesis.progress': (p) => {
    const jobId = getString(p, 'jobId');
    return [jobId ? ['synthesis-job', jobId] : ['synthesis-job']];
  },
  'synthesis.complete': (p) => {
    const jobId = getString(p, 'jobId');
    const projectId = getString(p, 'projectId');
    return [
      jobId ? ['synthesis-job', jobId] : ['synthesis-job'],
      ['modules'],
      ['module'],
      projectId ? ['git-status', projectId] : ['git-status'],
      projectId ? ['git-log', projectId] : ['git-log'],
      projectId ? ['git-tree', projectId] : ['git-tree'],
      projectId ? ['git-diff', projectId] : ['git-diff'],
    ];
  },
  'synthesis.error': (p) => {
    const jobId = getString(p, 'jobId');
    return [jobId ? ['synthesis-job', jobId] : ['synthesis-job']];
  },
};

/**
 * Global SSE subscription that invalidates TanStack Query caches based on
 * backend events. Chat-specific streaming events (`chat.<thread_id>.token`,
 * `…complete`, `…cancelled`, `…error`, `…context_trim`) are handled
 * separately in `useChatStream` so this hook doesn't thrash the
 * message-history cache on every token.
 *
 * Each event's `QueryKey` invalidation is scoped via the event payload
 * (e.g. `git.changed` only refetches *that* project's git queries, not
 * every project's). Drops the typical refetch volume from O(events × all
 * project queries) to O(events × ~3 keys).
 */
export function useSse() {
  const qc = useQueryClient();

  useEffect(() => {
    const source = new EventSource(eventStreamUrl('/v1/events'));

    const handle = (eventName: string) => (event: MessageEvent) => {
      const handler = HANDLERS[eventName];
      if (!handler) return;
      let payload: unknown = null;
      try {
        payload = event.data ? JSON.parse(event.data) : null;
      } catch {
        // Malformed payload — fall through with `null` so the handler's
        // fallback keys (the broad ones) still fire.
      }
      const keys = handler(payload);
      for (const queryKey of keys) {
        qc.invalidateQueries({ queryKey });
      }
    };

    // `sync.required` is emitted when the backend's broadcast buffer
    // skipped events for this consumer (background tab, throttled
    // mobile). We don't know which queries went stale — invalidate the
    // entire cache so the UI resyncs in one round-trip.
    const syncRequiredListener: EventListener = (event) => {
      const messageEvent = event as MessageEvent;
      let skipped: number | undefined;
      try {
        const parsed = messageEvent.data ? JSON.parse(messageEvent.data) : null;
        if (parsed && typeof parsed === 'object' && 'skipped' in parsed) {
          const raw = (parsed as Record<string, unknown>).skipped;
          if (typeof raw === 'number') skipped = raw;
        }
      } catch {
        // ignore
      }
      console.warn('[sse] sync.required — broadcast lagged', skipped ?? '?', 'events; invalidating all queries');
      qc.invalidateQueries();
    };
    source.addEventListener('sync.required', syncRequiredListener);

    const listeners: Array<[string, EventListener]> = [['sync.required', syncRequiredListener]];
    for (const eventName of Object.keys(HANDLERS)) {
      const listener = handle(eventName) as EventListener;
      source.addEventListener(eventName, listener);
      listeners.push([eventName, listener]);
    }

    // Surface connection errors so a silent disconnect doesn't masquerade
    // as a working stream. EventSource auto-reconnects internally; this
    // log is for ops visibility.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        console.warn('[sse] connection closed by server');
      }
    };

    return () => {
      for (const [eventName, listener] of listeners) {
        source.removeEventListener(eventName, listener);
      }
      source.close();
    };
  }, [qc]);
}
