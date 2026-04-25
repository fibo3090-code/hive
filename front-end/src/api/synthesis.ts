import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface SynthesisJob {
  id: string;
  projectId: string;
  status: 'queued' | 'completed' | 'error' | 'running' | string;
  description: string;
  tier: string | null;
  providerId: string | null;
  modelId: string | null;
  manifestJson: Record<string, unknown>;
  generatedFilesJson: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function useStartSynthesis(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { description: string; tier?: string | null; model?: { providerId: string; modelId: string } | null }) =>
      api<{ jobId: string }>(`/v1/projects/${projectId}/modules/synthesize`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
    },
  });
}

export function useSynthesisJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ['synthesis-job', jobId],
    queryFn: () => api<SynthesisJob>(`/v1/synthesis-jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'error' ? false : 1500;
    },
  });
}
