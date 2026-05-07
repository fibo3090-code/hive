import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export type DriftKind =
  | 'agent-vs-task'
  | 'code-vs-spec'
  | 'agent-vs-system-prompt';
export type DriftSeverity = 'low' | 'medium' | 'high';
export type DriftStatus = 'open' | 'approved' | 'corrected' | 'dismissed';

export interface DriftEvent {
  id: string;
  projectId: string;
  kind: DriftKind;
  /** Refers to whatever entity drifted — agent_id, task_id, requirement_id,
   *  spec_section_id depending on `subjectKind`. */
  subjectId: string;
  subjectKind: string;
  /** Detector-provided evidence: scores, diffs, sample turns. Free-form so
   *  the UI can render whatever the detector produced without a schema
   *  renegotiation. */
  evidenceJson: Record<string, unknown>;
  severity: DriftSeverity;
  status: DriftStatus;
  createdAt: string;
  resolvedAt: string | null;
}

const driftKey = (projectId: string | null | undefined, openOnly: boolean) =>
  ['drift-events', projectId ?? '_none', openOnly ? 'open' : 'all'] as const;

export function useDriftEvents(
  projectId: string | null | undefined,
  options: { openOnly?: boolean } = {},
) {
  const openOnly = options.openOnly ?? false;
  return useQuery({
    queryKey: driftKey(projectId, openOnly),
    queryFn: () =>
      api<DriftEvent[]>(
        `/v1/projects/${projectId}/drift-events${openOnly ? '?openOnly=true' : ''}`,
      ),
    enabled: Boolean(projectId),
  });
}

export function useUpdateDriftStatus(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: DriftStatus }) =>
      api<DriftEvent>(`/v1/drift-events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drift-events', projectId, 'open'] });
      qc.invalidateQueries({ queryKey: ['drift-events', projectId, 'all'] });
    },
  });
}
