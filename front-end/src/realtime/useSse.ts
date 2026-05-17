import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useRealtime } from './RealtimeProvider';
import { logger } from '@/lib/logger';

/**
 * Map of backend SSE event names to the `QueryKey` prefixes that should
 * be invalidated when one fires. Each handler optionally drills down via
 * the event payload — e.g. `agent.spawned` only invalidates the lineage
 * of the parent it actually spawned under, not every agent in the
 * project.
 */
type Invalidator = (payload: unknown) => readonly QueryKey[];

function getString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

const HANDLERS: Record<string, Invalidator> = {
  'project.updated': () => [['projects'], ['projects', 'active'], ['settings']],
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
  'task.autoDispatched': (p) => {
    const projectId = getString(p, 'projectId');
    const agentId = getString(p, 'agentId');
    return [
      projectId ? ['tasks', projectId] : ['tasks'],
      projectId ? ['agents', projectId] : ['agents'],
      agentId ? ['agent-messages', agentId] : ['agent-messages'],
    ];
  },
  'alert.created': () => [['alerts']],
  'alert.dismissed': () => [['alerts']],
  'notification.created': () => [['notifications']],
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
    return [['llm-providers'], id ? ['llm-providers', id, 'models'] : ['llm-providers']];
  },
  'llm_provider.tested': (p) => {
    const id = getString(p, 'id');
    return [['llm-providers'], id ? ['llm-providers', id, 'models'] : ['llm-providers']];
  },
  'workspace.updated': (p) => {
    const projectId = getString(p, 'projectId');
    return [projectId ? ['workspace-info', projectId] : ['workspace-info']];
  },
  'chat.thread.created': (p) => {
    const projectId = getString(p, 'projectId');
    return [projectId ? ['chat-threads', projectId] : ['chat-threads']];
  },
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
 * Global SSE → TanStack Query invalidation bridge. Subscribes through the
 * shared `RealtimeProvider` (single EventSource for the whole app) instead
 * of opening its own.
 */
export function useSse() {
  const qc = useQueryClient();
  const { subscribe } = useRealtime();

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const handle = (eventName: string) => (event: MessageEvent) => {
      const handler = HANDLERS[eventName];
      if (!handler) return;
      let payload: unknown = null;
      try {
        payload = event.data ? JSON.parse(event.data) : null;
      } catch {
        // malformed payload — fall through with null so broad keys still fire
      }
      const keys = handler(payload);
      for (const queryKey of keys) {
        qc.invalidateQueries({ queryKey });
      }
    };

    // sync.required = backend's broadcast buffer skipped events for this
    // consumer. We don't know which queries went stale → blanket invalidate.
    unsubs.push(
      subscribe('sync.required', (event) => {
        let skipped: number | undefined;
        try {
          const parsed = event.data ? JSON.parse(event.data) : null;
          if (parsed && typeof parsed === 'object' && 'skipped' in parsed) {
            const raw = (parsed as Record<string, unknown>).skipped;
            if (typeof raw === 'number') skipped = raw;
          }
        } catch {
          // ignore
        }
        logger.warn('sse', `sync.required — broadcast lagged ${skipped ?? '?'} events; invalidating all queries`);
        qc.invalidateQueries();
      }),
    );

    for (const eventName of Object.keys(HANDLERS)) {
      unsubs.push(subscribe(eventName, handle(eventName)));
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [qc, subscribe]);
}
