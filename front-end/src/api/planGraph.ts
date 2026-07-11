import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface PlanAgentDraft {
  role: string;
  name?: string | null;
  id?: string;
}

export interface PlanSprintNode {
  id: string;
  title: string;
  summary?: string | null;
  status?: string | null;
  level: number;
  order: number;
  points?: number;
}

export interface PlanTaskNode {
  id: string;
  sprintId: string;
  title: string;
  priority?: string | null;
  agentRole?: string | null;
  agentId?: string | null;
  status?: string | null;
  estimatedTokens?: number | null;
  level: number;
  order: number;
  specSectionId?: string | null;
}

export interface PlanEdge {
  id: string;
  from: string;
  to: string;
  kind?: string;
}

export interface PlanGraphPayload {
  spec?: string | null;
  agents: PlanAgentDraft[];
  sprintNodes: PlanSprintNode[];
  sprintEdges: PlanEdge[];
  taskNodes: PlanTaskNode[];
  taskEdges: PlanEdge[];
  requirements?: Array<Record<string, unknown>>;
  budgetEstimate?: { estimatedTokens: number; estimatedCostCents: number } | null;
  sourceCharacters?: number;
  assignments?: unknown[];
}

export const planGraphKey = (projectId?: string | null) => ['plan-graph', projectId ?? '_none'] as const;

export function usePlanGraph(projectId?: string | null) {
  return useQuery({
    queryKey: planGraphKey(projectId),
    queryFn: () => api<PlanGraphPayload>(`/v1/projects/${encodeURIComponent(String(projectId))}/plan-graph`),
    enabled: !!projectId,
  });
}

export function useSavePlanGraph(projectId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: PlanGraphPayload) => {
      if (!projectId) {
        throw new Error('Cannot save sprint graph without an active project.');
      }
      return api<{ sprintIds: string[]; taskIds: string[] }>(`/v1/projects/${encodeURIComponent(String(projectId))}/plan-graph`, {
        method: 'PUT',
        body: JSON.stringify(plan),
      });
    },
    onSuccess: () => {
      if (!projectId) return;
      void qc.invalidateQueries({ queryKey: planGraphKey(projectId) });
      void qc.invalidateQueries({ queryKey: ['tasks', projectId] });
      void qc.invalidateQueries({ queryKey: ['agents', projectId] });
      void qc.invalidateQueries({ queryKey: ['agent-task-assignments', projectId] });
    },
  });
}
