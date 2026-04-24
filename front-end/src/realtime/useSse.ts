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
    const invalidateAll = () => qc.invalidateQueries();
    const invalidateThreads = () => qc.invalidateQueries({ queryKey: ['chat-threads'] });

    [
      'project.updated',
      'agent.status',
      'task.status',
      'alert.created',
      'alert.dismissed',
      'notification.created',
      'session.toggled',
      'session.closed',
      'cost.ingested',
      'module.installed',
      'llm_provider.updated',
      'llm_provider.tested',
      'workspace.updated',
    ].forEach((eventName) => {
      source.addEventListener(eventName, invalidateAll);
    });

    source.addEventListener('chat.thread.created', invalidateThreads);

    return () => {
      source.close();
    };
  }, [qc]);
}
