import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export function useSettingsData() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<any>('/v1/settings'),
  });

  const saveMutation = useMutation({
    mutationFn: (settings: any) =>
      api<any>('/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return {
    ...query,
    saveSettings: (settings: any) => saveMutation.mutateAsync(settings),
  };
}

function projectQuery<T>(projectId: string | null | undefined, key: string, path: string) {
  return useQuery({
    queryKey: [key, projectId],
    queryFn: () => api<T>(`/v1/projects/${projectId}/${path}`),
    enabled: !!projectId,
  });
}

export const useNotesData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'notes', 'notes');
export const useTechDebtData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'tech-debt', 'tech-debt');
export const useSprintsData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'sprints', 'sprints');
export const useRequirementsData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'requirements', 'requirements');
export const useUserStoriesData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'user-stories', 'user-stories');
export const useActivityFeedData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'activity', 'activity');
export const useSessionHistoryData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'session-history', 'sessions/history');
export const useQualityTimelineData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'quality-timeline', 'insights/quality-over-time');
export const useSpendTimelineData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'spend-timeline', 'insights/spend');
export const useTaskThroughputData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'task-throughput', 'insights/task-throughput');
export const useModulesData = (projectId?: string | null) => projectQuery<any[]>(projectId, 'modules', 'modules');

export function useModuleData(moduleId?: string | null) {
  return useQuery({
    queryKey: ['module', moduleId],
    queryFn: () => api<any>(`/v1/modules/${moduleId}`),
    enabled: !!moduleId,
  });
}

export function useInstallModule(projectId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => api<any>(`/v1/projects/${projectId}/modules/${moduleId}/install`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
      qc.invalidateQueries({ queryKey: ['module'] });
    },
  });
}

export function useCreateNote(projectId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { category: string; title: string; content: string; auto?: boolean; author?: string }) =>
      api<any>(`/v1/projects/${projectId}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes', projectId] }),
  });
}

export function useMoveTechDebt(projectId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, severity }: { itemId: string; severity: string }) =>
      api<any>(`/v1/tech-debt/${itemId}/move`, {
        method: 'POST',
        body: JSON.stringify({ severity }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tech-debt', projectId] }),
  });
}

export function useReorderSprints(projectId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromId, toId }: { fromId: string; toId: string }) =>
      api<any>(`/v1/projects/${projectId}/sprints/reorder`, {
        method: 'POST',
        body: JSON.stringify({ fromId, toId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sprints', projectId] }),
  });
}

export const useAgentBlueprintsData = () =>
  useQuery({
    queryKey: ['agent-blueprints'],
    queryFn: () => api<any[]>('/v1/agent-blueprints'),
  });

export function useAgentMessagesData(agentId?: string | null) {
  return useQuery({
    queryKey: ['agent-messages', agentId],
    queryFn: () => api<any[]>(`/v1/agents/${agentId}/messages`),
    enabled: !!agentId,
  });
}
