import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * The seven UI states for an agent's work on a task. Surfaced as a
 * compact `AgentStateChip`. Mirrors the Rust enum string in
 * `agent_task_assignments.state`.
 */
export type AssignmentState =
  | 'paused'
  | 'started'
  | 'in-progress'
  | 'finished'
  | 'blocked'
  | 'awaiting-authorization'
  | 'requesting-input';

export interface AgentTaskAssignment {
  id: string;
  agentId: string;
  taskId: string;
  assignedAt: string;
  expectedCompletionAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** 0.0 = on track, 1.0 = severely diverged. Updated by the runtime
   *  drift detector after each turn. */
  driftScore: number;
  state: AssignmentState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssignmentInput {
  agentId: string;
  taskId: string;
  expectedCompletionAt?: string;
  state?: AssignmentState;
}

export interface UpdateAssignmentInput {
  state?: AssignmentState;
  startedAt?: string;
  completedAt?: string;
  expectedCompletionAt?: string;
  driftScore?: number;
}

const assignmentsKey = (projectId: string | null | undefined) =>
  ['agent-task-assignments', projectId ?? '_none'] as const;

export function useAssignments(projectId: string | null | undefined) {
  return useQuery({
    queryKey: assignmentsKey(projectId),
    queryFn: () =>
      api<AgentTaskAssignment[]>(
        `/v1/projects/${encodeURIComponent(String(projectId))}/agent-task-assignments`,
      ),
    enabled: Boolean(projectId),
  });
}

export function useCreateAssignment(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssignmentInput) =>
      api<AgentTaskAssignment>(
        `/v1/projects/${encodeURIComponent(String(projectId))}/agent-task-assignments`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: assignmentsKey(projectId) }),
  });
}

export function useUpdateAssignment(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAssignmentInput }) =>
      api<AgentTaskAssignment>(`/v1/agent-task-assignments/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: assignmentsKey(projectId) }),
  });
}
