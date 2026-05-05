import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export type ModuleVisibility = 'project' | 'public';

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
  /** RFC3339 timestamp; null until the user publishes. */
  publishedAt: string | null;
  publishedVisibility: ModuleVisibility | null;
  publishedSummary: string | null;
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

export function useProjectSynthesisJobs(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['synthesis-jobs', projectId],
    queryFn: () =>
      api<SynthesisJob[]>(`/v1/projects/${projectId}/synthesis-jobs`),
    enabled: Boolean(projectId),
    staleTime: 15_000,
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

export function usePublishedModules(visibility?: ModuleVisibility) {
  const qs = visibility ? `?visibility=${visibility}` : '';
  return useQuery({
    queryKey: ['modules', 'published', visibility ?? 'all'],
    queryFn: () => api<SynthesisJob[]>(`/v1/modules/published${qs}`),
    staleTime: 30_000,
  });
}

export function usePublishModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      jobId: string;
      visibility: ModuleVisibility;
      summary?: string;
    }) =>
      api<SynthesisJob>(`/v1/synthesis-jobs/${input.jobId}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          visibility: input.visibility,
          summary: input.summary,
        }),
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['modules'] });
      qc.invalidateQueries({ queryKey: ['synthesis-job', input.jobId] });
    },
  });
}

export function useUnpublishModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api<SynthesisJob>(`/v1/synthesis-jobs/${jobId}/unpublish`, {
        method: 'POST',
      }),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ['modules'] });
      qc.invalidateQueries({ queryKey: ['synthesis-job', jobId] });
    },
  });
}
