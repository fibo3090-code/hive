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

/** One row of the D1 eval pipeline — a scoring pass over an agent. */
export interface EvalRun {
  id: string;
  projectId: string;
  agentId: string;
  evaluator: string;
  scoresJson: Record<string, number>;
  overallScore: number;
  sampleSize: number;
  notes: string | null;
  createdAt: string;
}

export const useEvalRunsData = (projectId?: string | null) =>
  useProjectResourceQuery<EvalRun[]>(projectId, 'eval-runs', 'eval-runs');
export const useSessionHistoryData = (projectId?: string | null) =>
  useProjectResourceQuery<SessionHistoryItem[]>(projectId, 'session-history', 'sessions/history');
export const useQualityTimelineData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'quality-timeline', 'insights/quality-over-time');
export const useSpendTimelineData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'spend-timeline', 'insights/spend');
export const useTaskThroughputData = (projectId?: string | null) =>
  useProjectResourceQuery<TimelinePoint[]>(projectId, 'task-throughput', 'insights/task-throughput');

export interface CostTimelinePoint {
  /** ISO 8601 bucket start. */
  time: string;
  /** Total cost in cents within the bucket. */
  cents: number;
  /** Total tokens (in + out) within the bucket. */
  tokens: number;
}
export interface AgentTokenUsageRow {
  agentId: string;
  tokens: number;
}
export interface TaskDistributionRow {
  status: string;
  count: number;
}

export const useCostTimelineData = (
  projectId?: string | null,
  range = '24h',
  bucket = '1h',
) =>
  useQuery({
    queryKey: ['insights', 'cost-timeline', projectId, range, bucket],
    queryFn: () =>
      api<CostTimelinePoint[]>(
        `/v1/projects/${projectId}/insights/cost-timeline?range=${range}&bucket=${bucket}`,
      ),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

export const useAgentTokenUsageData = (
  projectId?: string | null,
  range = '24h',
) =>
  useQuery({
    queryKey: ['insights', 'agent-token-usage', projectId, range],
    queryFn: () =>
      api<AgentTokenUsageRow[]>(
        `/v1/projects/${projectId}/insights/agent-token-usage?range=${range}`,
      ),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

export const useTaskDistributionData = (projectId?: string | null) =>
  useQuery({
    queryKey: ['insights', 'task-distribution', projectId],
    queryFn: () =>
      api<TaskDistributionRow[]>(
        `/v1/projects/${projectId}/insights/task-distribution`,
      ),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
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

export function useUpdateNote(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      noteId,
      patch,
    }: {
      noteId: string;
      patch: { category?: string; title?: string; content?: string };
    }) =>
      api<NoteItem>(`/v1/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', projectId] }),
  });
}

export function useDeleteNote(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      api<{ ok: boolean }>(`/v1/notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes', projectId] }),
  });
}

export function useUpdateTechDebt(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      patch,
    }: {
      itemId: string;
      patch: {
        title?: string;
        description?: string | null;
        file?: string | null;
        impact?: string | null;
        severity?: string;
        lines?: number;
      };
    }) =>
      api<TechDebtItem>(`/v1/tech-debt/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tech-debt', projectId] }),
  });
}

export function useDeleteTechDebt(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      api<{ ok: boolean }>(`/v1/tech-debt/${itemId}`, { method: 'DELETE' }),
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
