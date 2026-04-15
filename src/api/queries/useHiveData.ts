import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import type { Agent, AgentStatus, AlertItem, Notification, Project, SessionInfo, TaskItem } from '@/types/domain';

const keys = {
  projects: ['projects'] as const,
  activeProject: ['projects', 'active'] as const,
  project: (id?: string | null) => ['projects', id] as const,
  agents: (id?: string | null) => ['agents', id] as const,
  tasks: (id?: string | null) => ['tasks', id] as const,
  alerts: (id?: string | null) => ['alerts', id] as const,
  session: (id?: string | null) => ['session', id] as const,
  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
};

const emptySession: SessionInfo = {
  isActive: false,
  agentCount: 0,
  elapsed: '00:00:00',
  tokensUsed: 0,
  budgetUsed: 0,
  budgetTotal: 0,
};

async function fetchProjects() {
  return api<Project[]>('/v1/projects');
}

async function fetchActiveProject() {
  return api<Project | null>('/v1/projects/active');
}

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: fetchProjects });
}

export function useActiveProject() {
  return useQuery({ queryKey: keys.activeProject, queryFn: fetchActiveProject });
}

export function useProject(projectId?: string | null) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => api<Project>(`/v1/projects/${projectId}`),
    enabled: !!projectId,
  });
}

export function useAgents(projectId?: string | null) {
  return useQuery({
    queryKey: keys.agents(projectId),
    queryFn: () => api<Agent[]>(`/v1/projects/${projectId}/agents`),
    enabled: !!projectId,
  });
}

export function useTasks(projectId?: string | null, agentsById?: Record<string, Agent>) {
  return useQuery({
    queryKey: keys.tasks(projectId),
    queryFn: async () => {
      const rows = await api<Array<Omit<TaskItem, 'assignee'> & { agentId?: string | null }>>(`/v1/projects/${projectId}/tasks`);
      return rows.map((task) => ({
        ...task,
        assignee: task.agentId ? agentsById?.[task.agentId]?.name ?? 'Unassigned' : 'Unassigned',
      })) as TaskItem[];
    },
    enabled: !!projectId,
  });
}

export function useAlerts(projectId?: string | null) {
  return useQuery({
    queryKey: keys.alerts(projectId),
    queryFn: () => api<AlertItem[]>(`/v1/projects/${projectId}/alerts`),
    enabled: !!projectId,
  });
}

export function useSession(projectId?: string | null) {
  return useQuery({
    queryKey: keys.session(projectId),
    queryFn: () => api<SessionInfo>(`/v1/projects/${projectId}/session`),
    enabled: !!projectId,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api<Notification[]>('/v1/notifications'),
  });
}

export function useHiveData() {
  const qc = useQueryClient();
  const projectsQuery = useProjects();
  const activeProjectQuery = useActiveProject();
  const activeProject = activeProjectQuery.data ?? projectsQuery.data?.[0] ?? null;
  const projectId = activeProject?.id ?? null;

  const agentsQuery = useAgents(projectId);
  const agentsById = useMemo(
    () => Object.fromEntries((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data]
  );
  const tasksQuery = useTasks(projectId, agentsById);
  const alertsQuery = useAlerts(projectId);
  const sessionQuery = useSession(projectId);
  const notificationsQuery = useNotifications();

  const invalidateProject = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: keys.projects }),
      qc.invalidateQueries({ queryKey: keys.activeProject }),
      qc.invalidateQueries({ queryKey: keys.project(projectId) }),
      qc.invalidateQueries({ queryKey: keys.agents(projectId) }),
      qc.invalidateQueries({ queryKey: keys.tasks(projectId) }),
      qc.invalidateQueries({ queryKey: keys.alerts(projectId) }),
      qc.invalidateQueries({ queryKey: keys.session(projectId) }),
      qc.invalidateQueries({ queryKey: keys.notifications }),
      qc.invalidateQueries({ queryKey: keys.settings }),
    ]);
  };

  const activateMutation = useMutation({
    mutationFn: (nextProjectId: string) => api<{ ok: true }>(`/v1/projects/${nextProjectId}/activate`, { method: 'POST' }),
    onSuccess: invalidateProject,
  });

  const createProjectMutation = useMutation({
    mutationFn: (project: { name: string; description?: string; sovereigntyTier: Project['sovereigntyTier']; budgetTotalCents: number; status?: Project['status'] }) =>
      api<Project>('/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: project.name,
          description: project.description,
          sovereigntyTier: project.sovereigntyTier,
          budgetTotalCents: project.budgetTotalCents,
          status: project.status ?? 'active',
        }),
      }),
    onSuccess: invalidateProject,
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ projectId: nextProjectId, changes }: { projectId: string; changes: Partial<Project> }) =>
      api<Project>(`/v1/projects/${nextProjectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: changes.name,
          description: changes.description,
          sovereigntyTier: changes.sovereigntyTier,
          status: changes.status,
          healthScore: changes.healthScore,
          specCompletion: changes.specCompletion,
          testCoverage: changes.testCoverage,
          budgetTotalCents: changes.budget ? changes.budget.total * 100 : undefined,
        }),
      }),
    onSuccess: invalidateProject,
  });

  const toggleSessionMutation = useMutation({
    mutationFn: () => api<SessionInfo>(`/v1/projects/${projectId}/session/toggle`, { method: 'POST' }),
    onSuccess: invalidateProject,
  });

  const extendBudgetMutation = useMutation({
    mutationFn: (newTotal: number) =>
      api<Project>(`/v1/projects/${projectId}/budget/extend`, {
        method: 'POST',
        body: JSON.stringify({ newTotalCents: newTotal * 100 }),
      }),
    onSuccess: invalidateProject,
  });

  const dismissAlertMutation = useMutation({
    mutationFn: (alertId: string) => api<{ ok: true }>(`/v1/alerts/${alertId}/dismiss`, { method: 'POST' }),
    onSuccess: invalidateProject,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskItem['status'] }) =>
      api<TaskItem>(`/v1/tasks/${taskId}/set-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidateProject,
  });

  const setAgentStatusMutation = useMutation({
    mutationFn: ({ agentId, status }: { agentId: string; status: AgentStatus }) =>
      api<Agent>(`/v1/agents/${agentId}/set-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidateProject,
  });

  const markNotificationReadMutation = useMutation({
    mutationFn: (notificationId: string) => api<{ ok: true }>(`/v1/notifications/${notificationId}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });

  const markAllNotificationsReadMutation = useMutation({
    mutationFn: () => api<{ ok: true }>('/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });

  const dismissNotificationMutation = useMutation({
    mutationFn: (notificationId: string) => api<{ ok: true }>(`/v1/notifications/${notificationId}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });

  const state = {
    session: sessionQuery.data ?? emptySession,
    projects: projectsQuery.data ?? [],
    agents: agentsQuery.data ?? [],
    tasks: tasksQuery.data ?? [],
    alerts: alertsQuery.data ?? [],
    notifications: notificationsQuery.data ?? [],
    activeProjectId: projectId,
    healthScore: activeProject?.healthScore ?? 0,
  };

  return {
    state,
    activeProject,
    isLoading:
      projectsQuery.isLoading ||
      activeProjectQuery.isLoading ||
      agentsQuery.isLoading ||
      tasksQuery.isLoading ||
      alertsQuery.isLoading ||
      sessionQuery.isLoading ||
      notificationsQuery.isLoading,
    toggleSession: () => toggleSessionMutation.mutateAsync(),
    dismissAlert: (id: string) => dismissAlertMutation.mutateAsync(id),
    dismissNotification: (id: string) => dismissNotificationMutation.mutateAsync(id),
    markNotificationRead: (id: string) => markNotificationReadMutation.mutateAsync(id),
    markAllNotificationsRead: () => markAllNotificationsReadMutation.mutateAsync(),
    updateTaskStatus: (taskId: string, status: TaskItem['status']) => updateTaskMutation.mutateAsync({ taskId, status }),
    setAgentStatus: (agentId: string, status: AgentStatus) => setAgentStatusMutation.mutateAsync({ agentId, status }),
    extendBudget: (newTotal: number) => extendBudgetMutation.mutateAsync(newTotal),
    setActiveProject: (nextProjectId: string) => activateMutation.mutateAsync(nextProjectId),
    addProject: (project: { name: string; description?: string; sovereigntyTier: Project['sovereigntyTier']; budgetTotalCents: number; status?: Project['status'] }) =>
      createProjectMutation.mutateAsync(project),
    updateProject: (projectIdToUpdate: string, changes: Partial<Project>) =>
      updateProjectMutation.mutateAsync({ projectId: projectIdToUpdate, changes }),
  };
}
