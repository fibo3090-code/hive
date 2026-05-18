import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * State machine for the auto-spawn pipeline. Stages run in this order
 * (some optional):
 *   queued → planning-needs → matching-existing-mcp →
 *   [researching-api → synthesizing-mcp]* → composing-prompt →
 *   [awaiting-approval] → materializing-agent → completed
 * `failed` and `cancelled` are terminal.
 */
export type SpawnStatus =
  | 'queued'
  | 'planning-needs'
  | 'matching-existing-mcp'
  | 'researching-api'
  | 'synthesizing-mcp'
  | 'composing-prompt'
  | 'awaiting-approval'
  | 'materializing-agent'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type McpStrategy =
  | 'none'
  | 'reuse-only'
  | 'reuse-or-synth'
  | 'force-synth';

export interface AgentSpawnRequest {
  id: string;
  projectId: string;
  parentAgentId: string | null;
  requestedRole: string;
  requestedCapabilitiesJson: string[];
  contextJson: Record<string, unknown>;
  mcpStrategy: McpStrategy;
  status: SpawnStatus;
  childAgentId: string | null;
  discoveredApiJson: Record<string, unknown> | null;
  matchedExistingMcpIdsJson: string[];
  synthesizedMcpIdsJson: string[];
  generatedSystemPrompt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateSpawnRequestInput {
  parentAgentId?: string;
  requestedRole: string;
  requestedCapabilitiesJson?: string[];
  contextJson?: Record<string, unknown>;
  mcpStrategy?: McpStrategy;
}

export interface UpdateSpawnRequestInput {
  status?: SpawnStatus;
  childAgentId?: string;
  discoveredApiJson?: Record<string, unknown>;
  matchedExistingMcpIdsJson?: string[];
  synthesizedMcpIdsJson?: string[];
  generatedSystemPrompt?: string;
  error?: string;
  completed?: boolean;
}

const spawnKey = (projectId: string | null | undefined) =>
  ['spawn-requests', projectId ?? '_none'] as const;

export function useSpawnRequests(projectId: string | null | undefined) {
  return useQuery({
    queryKey: spawnKey(projectId),
    queryFn: () =>
      api<AgentSpawnRequest[]>(`/v1/projects/${projectId}/spawn-requests`),
    enabled: Boolean(projectId),
  });
}

export function useSpawnRequest(spawnRequestId: string | null | undefined) {
  return useQuery({
    queryKey: ['spawn-request', spawnRequestId ?? '_none'],
    queryFn: () =>
      api<AgentSpawnRequest>(`/v1/spawn-requests/${spawnRequestId}`),
    enabled: Boolean(spawnRequestId),
    // Auto-refresh while the pipeline is running. The UI also subscribes
    // to `agent_spawn_request.updated` SSE for instant deltas.
    refetchInterval: (query) => {
      const data = query.state.data as AgentSpawnRequest | undefined;
      const terminal = data &&
        (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled');
      return terminal ? false : 1500;
    },
  });
}

export function useCreateSpawnRequest(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSpawnRequestInput) =>
      api<AgentSpawnRequest>(`/v1/projects/${projectId}/spawn-requests`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: spawnKey(projectId) }),
  });
}

export function useUpdateSpawnRequest(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSpawnRequestInput }) =>
      api<AgentSpawnRequest>(`/v1/spawn-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (req) => {
      qc.invalidateQueries({ queryKey: spawnKey(projectId) });
      qc.invalidateQueries({ queryKey: ['spawn-request', req.id] });
    },
  });
}

/**
 * Approve a spawn request that's parked in `awaiting-approval`. Resumes the
 * pipeline server-side; the request is expected to move to `materializing-agent`
 * and then `completed` over the next few seconds.
 */
export function useApproveSpawnRequest(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/v1/spawn-requests/${id}/approve`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: spawnKey(projectId) });
      qc.invalidateQueries({ queryKey: ['spawn-request', id] });
    },
  });
}

/**
 * Reject a spawn request: flips it to `cancelled` via the generic PATCH path.
 * The backend's pipeline checks this status before each step and stops.
 */
export function useRejectSpawnRequest(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AgentSpawnRequest>(`/v1/spawn-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' satisfies SpawnStatus }),
      }),
    onSuccess: (req) => {
      qc.invalidateQueries({ queryKey: spawnKey(projectId) });
      qc.invalidateQueries({ queryKey: ['spawn-request', req.id] });
    },
  });
}
