import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface AgentMessageLog {
  id: string;
  projectId: string;
  fromAgentId: string | null;
  toAgentId: string;
  threadId: string | null;
  replyToMessageId: string | null;
  content: string;
  toolCalls: unknown;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  createdAt: string;
  completedAt: string | null;
}

export interface AgentLineage {
  parents: Array<{ id: string; name: string; role: string }>;
  children: Array<{ id: string; name: string; role: string; status: string }>;
}

export function useAgentMessages(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ['agent-messages', agentId],
    queryFn: () => api<AgentMessageLog[]>(`/v1/agents/${agentId}/messages`),
    enabled: Boolean(agentId),
  });
}

export function useAgentLineage(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ['agent-lineage', agentId],
    queryFn: () => api<AgentLineage>(`/v1/agents/${agentId}/lineage`),
    enabled: Boolean(agentId),
  });
}

function invalidateAgentQueries(qc: ReturnType<typeof useQueryClient>, agentId?: string | null) {
  qc.invalidateQueries({ queryKey: ['agents'] });
  qc.invalidateQueries({ queryKey: ['agent-messages', agentId] });
  qc.invalidateQueries({ queryKey: ['agent-lineage', agentId] });
}

export function usePauseAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${agentId}/pause`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useResumeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${agentId}/resume`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useTerminateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${agentId}/terminate`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useDispatchAgentTask(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api<{ messageId: string }>(`/v1/agents/${agentId}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      invalidateAgentQueries(qc, agentId);
    },
  });
}
