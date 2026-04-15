import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type {
  ActivityFeedItem,
  AgentBlueprint,
  ModuleCatalogItem,
  NoteItem,
  RequirementItem,
  SessionHistoryItem,
  SprintPlanItem,
  TechDebtItem,
  TimelinePoint,
  UserStoryItem,
} from '@/types/domain';
import type { SettingsState } from '@/context/WorkspaceContext';

export function useSettingsData() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsState>('/v1/settings'),
  });

  const saveMutation = useMutation({
    mutationFn: (settings: SettingsState) =>
      api<SettingsState>('/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return {
    ...query,
    saveSettings: (settings: SettingsState) => saveMutation.mutateAsync(settings),
  };
}

function useProjectResourceQuery<T>(projectId: string | null | undefined, key: string, path: string) {
  return useQuery({
    queryKey: [key, projectId],
    queryFn: () => api<T>(`/v1/projects/${projectId}/${path}`),
    enabled: Boolean(projectId),
  });
}

export const useNotesData = (projectId?: string | null) => useProjectResourceQuery<NoteItem[]>(projectId, 'notes', 'notes');
export const useTechDebtData = (projectId?: string | null) => useProjectResourceQuery<TechDebtItem[]>(projectId, 'tech-debt', 'tech-debt');
export const useSprintsData = (projectId?: string | null) => useProjectResourceQuery<SprintPlanItem[]>(projectId, 'sprints', 'sprints');
export const useRequirementsData = (projectId?: string | null) =>
  useProjectResourceQuery<RequirementItem[]>(projectId, 'requirements', 'requirements');
export const useUserStoriesData = (projectId?: string | null) =>
  useProjectResourceQuery<UserStoryItem[]>(projectId, 'user-stories', 'user-stories');
export const useActivityFeedData = (projectId?: string | null) =>
  useProjectResourceQuery<ActivityFeedItem[]>(projectId, 'activity', 'activity');
export const useSessionHistoryData = (projectId?: string | null) =>
  useProjectResourceQuery<SessionHistoryItem[]>(projectId, 'session-history', 'sessions/history');
export const useQualityTimelineData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'quality-timeline', 'insights/quality-over-time');
export const useSpendTimelineData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'spend-timeline', 'insights/spend');
export const useTaskThroughputData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'task-throughput', 'insights/task-throughput');
export const useModulesData = (projectId?: string | null) =>
  useProjectResourceQuery<ModuleCatalogItem[]>(projectId, 'modules', 'modules');

export function useModuleData(moduleId?: string | null) {
  return useQuery({
    queryKey: ['module', moduleId],
    queryFn: () => api<ModuleCatalogItem>(`/v1/modules/${moduleId}`),
    enabled: Boolean(moduleId),
  });
}

export function useInstallModule(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) =>
      api<ModuleCatalogItem>(`/v1/projects/${projectId}/modules/${moduleId}/install`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      queryClient.invalidateQueries({ queryKey: ['module'] });
    },
  });
}

export function useCreateNote(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { category: string; title: string; content: string; auto?: boolean; author?: string }) =>
      api<NoteItem>(`/v1/projects/${projectId}/notes`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', projectId] }),
  });
}

export function useMoveTechDebt(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, severity }: { itemId: string; severity: string }) =>
      api<TechDebtItem>(`/v1/tech-debt/${itemId}/move`, {
        method: 'POST',
        body: JSON.stringify({ severity }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tech-debt', projectId] }),
  });
}

export function useReorderSprints(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fromId, toId }: { fromId: string; toId: string }) =>
      api<SprintPlanItem[]>(`/v1/projects/${projectId}/sprints/reorder`, {
        method: 'POST',
        body: JSON.stringify({ fromId, toId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sprints', projectId] }),
  });
}

export const useAgentBlueprintsData = () =>
  useQuery({
    queryKey: ['agent-blueprints'],
    queryFn: () => api<AgentBlueprint[]>('/v1/agent-blueprints'),
  });

export function useAgentMessagesData(agentId?: string | null) {
  return useQuery({
    queryKey: ['agent-messages', agentId],
    queryFn: () => api<unknown[]>(`/v1/agents/${agentId}/messages`),
    enabled: Boolean(agentId),
  });
}
