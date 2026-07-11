import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Skill } from '@/api/skills';

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
    queryFn: () => api<AgentMessageLog[]>(`/v1/agents/${encodeURIComponent(String(agentId))}/messages`),
    enabled: Boolean(agentId),
  });
}

export function useAgentLineage(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ['agent-lineage', agentId],
    queryFn: () => api<AgentLineage>(`/v1/agents/${encodeURIComponent(String(agentId))}/lineage`),
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
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}/pause`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useResumeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}/resume`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useTerminateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<{ id: string; status: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}/terminate`, { method: 'POST' }),
    onSuccess: (_result, agentId) => invalidateAgentQueries(qc, agentId),
  });
}

export function useDispatchAgentTask(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api<{ messageId: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      invalidateAgentQueries(qc, agentId);
    },
  });
}

export interface AgentUpdateInput {
  name?: string;
  role?: string;
  model?: string;
  /** `null` clears the override; omit the field to leave alone. */
  systemPrompt?: string | null;
  modelProviderId?: string | null;
  modelId?: string | null;
  enabledTools?: string[];
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, patch }: { agentId: string; patch: AgentUpdateInput }) =>
      api<{ id: string; status: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (_result, vars) => invalidateAgentQueries(qc, vars.agentId),
  });
}

export interface AgentWire {
  id: string;
  projectId: string;
  parentAgentId: string;
  childAgentId: string;
  createdAt: string;
}

export function useWires(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['wires', projectId],
    queryFn: () => api<AgentWire[]>(`/v1/projects/${encodeURIComponent(String(projectId))}/wires`),
    enabled: Boolean(projectId),
  });
}

export function useCreateWire(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { parentAgentId: string; childAgentId: string }) =>
      api<AgentWire>(`/v1/projects/${encodeURIComponent(String(projectId))}/wires`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wires', projectId] }),
  });
}

export function useDeleteWire(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wireId: string) => api<{ ok: boolean }>(`/v1/wires/${encodeURIComponent(String(wireId))}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wires', projectId] }),
  });
}

export interface ToolDescriptor {
  name: string;
  description: string;
  sideEffects: boolean;
  category: string;
}

export function useToolCatalog() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => api<ToolDescriptor[]>('/v1/tools'),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Agent ↔ Skill bindings ─────────────────────────────────────────────

const agentSkillsKey = (agentId: string | null | undefined) =>
  ['agent-skills', agentId] as const;

/** Skills bound to a given agent (joined server-side for convenience). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentSkillsKey(agentId),
    queryFn: () => api<Skill[]>(`/v1/agents/${encodeURIComponent(String(agentId))}/skills`),
    enabled: Boolean(agentId),
  });
}

export function useBindAgentSkill(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) =>
      api<{ id: string }>(`/v1/agents/${encodeURIComponent(String(agentId))}/skills`, {
        method: 'POST',
        body: JSON.stringify({ skillId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentSkillsKey(agentId) }),
  });
}

export function useUnbindAgentSkill(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) =>
      api<{ ok: true; removed: number }>(`/v1/agents/${encodeURIComponent(String(agentId))}/skills/${encodeURIComponent(String(skillId))}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentSkillsKey(agentId) }),
  });
}
