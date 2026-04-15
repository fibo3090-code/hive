import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { eventStreamUrl } from '@/api/client';

export function useSse() {
  const qc = useQueryClient();

  useEffect(() => {
    const source = new EventSource(eventStreamUrl('/v1/events'));
    const invalidateAll = () => qc.invalidateQueries();

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
    ].forEach((eventName) => {
      source.addEventListener(eventName, invalidateAll);
    });

    return () => {
      source.close();
    };
  }, [qc]);
}
