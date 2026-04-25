import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eventStreamUrl } from '@/api/client';

/**
 * Global SSE subscription that invalidates TanStack Query caches based on
 * backend events. Chat-specific streaming events (`chat.<thread_id>.token`,
 * `…complete`, `…cancelled`, `…error`) are handled separately in
 * `useChatStream` so this hook doesn't thrash the message-history cache on
 * every token.
 */
export function useSse() {
  const qc = useQueryClient();

  useEffect(() => {
    const source = new EventSource(eventStreamUrl('/v1/events'));
    const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) => {
      keys.forEach((queryKey) => {
        qc.invalidateQueries({ queryKey });
      });
    };

    source.addEventListener('project.updated', () => {
      invalidate(['projects'], ['projects', 'active'], ['settings']);
    });
    source.addEventListener('agent.status', () => {
      invalidate(['agents'], ['agent-messages'], ['agent-lineage']);
    });
    source.addEventListener('task.status', () => {
      invalidate(['tasks']);
    });
    source.addEventListener('alert.created', () => {
      invalidate(['alerts']);
    });
    source.addEventListener('alert.dismissed', () => {
      invalidate(['alerts']);
    });
    source.addEventListener('notification.created', () => {
      invalidate(['notifications']);
    });
    source.addEventListener('session.toggled', () => {
      invalidate(['session'], ['projects']);
    });
    source.addEventListener('session.closed', () => {
      invalidate(['session'], ['session-history']);
    });
    source.addEventListener('cost.ingested', () => {
      invalidate(['projects'], ['spend-timeline']);
    });
    source.addEventListener('module.installed', () => {
      invalidate(['modules'], ['module']);
    });
    source.addEventListener('llm_provider.updated', () => {
      invalidate(['llm-providers']);
    });
    source.addEventListener('llm_provider.tested', () => {
      invalidate(['llm-providers']);
    });
    source.addEventListener('workspace.updated', () => {
      invalidate(['workspace-info']);
    });
    source.addEventListener('chat.thread.created', () => {
      invalidate(['chat-threads']);
    });
    source.addEventListener('git.changed', () => {
      invalidate(['git-status'], ['git-branches'], ['git-log'], ['git-tree'], ['git-diff'], ['git-file']);
    });
    source.addEventListener('synthesis.progress', () => {
      invalidate(['synthesis-job']);
    });
    source.addEventListener('synthesis.complete', () => {
      invalidate(['synthesis-job'], ['modules'], ['module'], ['git-status'], ['git-log'], ['git-tree'], ['git-diff']);
    });
    source.addEventListener('synthesis.error', () => {
      invalidate(['synthesis-job']);
    });

    return () => {
      source.close();
    };
  }, [qc]);
}
