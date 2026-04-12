import React, { createContext, useContext, useReducer, useCallback, useEffect, type Dispatch } from 'react';
import {
  mockAgents, mockTasks, mockAlerts, mockProjects, mockSession,
  type Project, type TaskItem, type AlertItem, type SessionInfo, type AgentStatus,
} from '@/data/mockData';

/* ─── Notification type (lives in context now) ─── */
export interface Notification {
  id: string;
  type: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  message: string;
  time: string;
  read: boolean;
  actionable?: boolean;
  actionLabel?: string;
}

const initialNotifications: Notification[] = [
  { id: 'n1', type: 'critical', title: 'Budget threshold reached', message: 'Project budget at 89% — 3 agents throttled', time: '2 min ago', read: false, actionable: true, actionLabel: 'Extend Budget' },
  { id: 'n2', type: 'high', title: 'Agent loop detected', message: 'Doc Writer repeated same action 4 times', time: '8 min ago', read: false, actionable: true, actionLabel: 'Intervene' },
  { id: 'n3', type: 'medium', title: 'Spec drift in §4.2', message: 'Implementation diverged from PRD', time: '23 min ago', read: false, actionable: true, actionLabel: 'Review' },
  { id: 'n4', type: 'info', title: 'Eval batch complete', message: 'QA Sentinel — 94% pass rate', time: '45 min ago', read: false },
  { id: 'n5', type: 'info', title: 'PR #11 ready', message: 'Backend Engineer: auth middleware', time: '1 hr ago', read: true },
  { id: 'n6', type: 'medium', title: 'Test coverage dropped', message: 'Coverage fell below 70% threshold', time: '1.5 hr ago', read: true },
  { id: 'n7', type: 'high', title: 'Security scan warning', message: 'Potential credential leak in config.ts', time: '2 hr ago', read: true, actionable: true, actionLabel: 'Review' },
];

/* ─── State shape ─── */
export interface HiveState {
  session: SessionInfo;
  projects: Project[];
  agents: typeof mockAgents;
  tasks: TaskItem[];
  alerts: AlertItem[];
  notifications: Notification[];
  activeProjectId: string | null;
  healthScore: number;
}

const STORAGE_KEY = 'hive-runtime';

function syncProjectMetrics(state: HiveState, projectId: string | null) {
  const activeProject = state.projects.find((project) => project.id === projectId) ?? state.projects[0] ?? null;

  if (!activeProject) {
    return state;
  }

  return {
    ...state,
    activeProjectId: activeProject.id,
    healthScore: activeProject.healthScore,
    session: {
      ...state.session,
      budgetUsed: activeProject.budget.used,
      budgetTotal: activeProject.budget.total,
      agentCount: activeProject.agentCount,
    },
  };
}

const initialState: HiveState = syncProjectMetrics({
  session: { ...mockSession },
  projects: [...mockProjects],
  agents: [...mockAgents],
  tasks: [...mockTasks],
  alerts: [...mockAlerts],
  notifications: initialNotifications,
  activeProjectId: 'proj-001',
  healthScore: 87,
}, 'proj-001');

function readInitialState(): HiveState {
  if (typeof window === 'undefined') {
    return initialState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return initialState;
    }

    const parsed = JSON.parse(raw) as Partial<HiveState>;
    const hydrated: HiveState = {
      ...initialState,
      ...parsed,
      projects: parsed.projects ?? initialState.projects,
      agents: parsed.agents ?? initialState.agents,
      tasks: parsed.tasks ?? initialState.tasks,
      alerts: parsed.alerts ?? initialState.alerts,
      notifications: parsed.notifications ?? initialState.notifications,
      session: { ...initialState.session, ...parsed.session },
    };

    return syncProjectMetrics(hydrated, hydrated.activeProjectId);
  } catch (error) {
    console.error('Failed to read hive runtime state', error);
    return initialState;
  }
}

/* ─── Actions ─── */
export type HiveAction =
  | { type: 'TOGGLE_SESSION' }
  | { type: 'SET_SESSION_ACTIVE'; payload: boolean }
  | { type: 'UPDATE_BUDGET'; payload: { used?: number; total?: number } }
  | { type: 'SET_AGENT_STATUS'; payload: { agentId: string; status: AgentStatus } }
  | { type: 'DISMISS_ALERT'; payload: string }
  | { type: 'ADD_ALERT'; payload: AlertItem }
  | { type: 'UPDATE_TASK_STATUS'; payload: { taskId: string; status: TaskItem['status'] } }
  | { type: 'MARK_NOTIFICATION_READ'; payload: string }
  | { type: 'MARK_ALL_NOTIFICATIONS_READ' }
  | { type: 'DISMISS_NOTIFICATION'; payload: string }
  | { type: 'SET_ACTIVE_PROJECT'; payload: string }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'UPDATE_PROJECT'; payload: { projectId: string; changes: Partial<Project> } }
  | { type: 'SET_HEALTH_SCORE'; payload: number };

function hiveReducer(state: HiveState, action: HiveAction): HiveState {
  switch (action.type) {
    case 'TOGGLE_SESSION':
      return {
        ...state,
        session: { ...state.session, isActive: !state.session.isActive },
        agents: state.agents.map(a =>
          a.status === 'working'
            ? { ...a, status: state.session.isActive ? 'paused' as const : 'working' as const }
            : a.status === 'paused' && !state.session.isActive
              ? { ...a, status: 'working' as const }
              : a
        ),
      };

    case 'SET_SESSION_ACTIVE':
      return {
        ...state,
        session: { ...state.session, isActive: action.payload },
        agents: state.agents.map(a =>
          !action.payload && a.status === 'working'
            ? { ...a, status: 'paused' as const }
            : action.payload && a.status === 'paused'
              ? { ...a, status: 'working' as const }
              : a
        ),
      };

    case 'UPDATE_BUDGET':
      return {
        ...state,
        session: {
          ...state.session,
          budgetUsed: action.payload.used ?? state.session.budgetUsed,
          budgetTotal: action.payload.total ?? state.session.budgetTotal,
        },
      };

    case 'SET_AGENT_STATUS':
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.payload.agentId ? { ...a, status: action.payload.status } : a
        ),
      };

    case 'DISMISS_ALERT':
      return {
        ...state,
        alerts: state.alerts.filter(a => a.id !== action.payload),
      };

    case 'ADD_ALERT':
      return { ...state, alerts: [action.payload, ...state.alerts] };

    case 'UPDATE_TASK_STATUS':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.payload.taskId ? { ...t, status: action.payload.status } : t
        ),
      };

    case 'MARK_NOTIFICATION_READ':
      return {
        ...state,
        notifications: state.notifications.map(n =>
          n.id === action.payload ? { ...n, read: true } : n
        ),
      };

    case 'MARK_ALL_NOTIFICATIONS_READ':
      return {
        ...state,
        notifications: state.notifications.map(n => ({ ...n, read: true })),
      };

    case 'DISMISS_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload),
      };

    case 'SET_ACTIVE_PROJECT':
      return syncProjectMetrics(state, action.payload);

    case 'ADD_PROJECT':
      return syncProjectMetrics({
        ...state,
        projects: [action.payload, ...state.projects],
      }, action.payload.id);

    case 'UPDATE_PROJECT': {
      const projects = state.projects.map((project) =>
        project.id === action.payload.projectId
          ? { ...project, ...action.payload.changes }
          : project
      );

      return syncProjectMetrics({ ...state, projects }, state.activeProjectId);
    }

    case 'SET_HEALTH_SCORE':
      return { ...state, healthScore: action.payload };

    default:
      return state;
  }
}

/* ─── Context ─── */
interface HiveContextValue {
  state: HiveState;
  activeProject: Project | null;
  dispatch: Dispatch<HiveAction>;
  // Convenience helpers
  toggleSession: () => void;
  dismissAlert: (id: string) => void;
  dismissNotification: (id: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  updateTaskStatus: (taskId: string, status: TaskItem['status']) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  extendBudget: (newTotal: number) => void;
  setActiveProject: (projectId: string) => void;
  addProject: (project: Project) => void;
  updateProject: (projectId: string, changes: Partial<Project>) => void;
}

const HiveContext = createContext<HiveContextValue | null>(null);

export function HiveProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(hiveReducer, undefined, readInitialState);

  const toggleSession = useCallback(() => dispatch({ type: 'TOGGLE_SESSION' }), []);
  const dismissAlert = useCallback((id: string) => dispatch({ type: 'DISMISS_ALERT', payload: id }), []);
  const dismissNotification = useCallback((id: string) => dispatch({ type: 'DISMISS_NOTIFICATION', payload: id }), []);
  const markNotificationRead = useCallback((id: string) => dispatch({ type: 'MARK_NOTIFICATION_READ', payload: id }), []);
  const markAllNotificationsRead = useCallback(() => dispatch({ type: 'MARK_ALL_NOTIFICATIONS_READ' }), []);
  const updateTaskStatus = useCallback((taskId: string, status: TaskItem['status']) =>
    dispatch({ type: 'UPDATE_TASK_STATUS', payload: { taskId, status } }), []);
  const setAgentStatus = useCallback((agentId: string, status: AgentStatus) =>
    dispatch({ type: 'SET_AGENT_STATUS', payload: { agentId, status } }), []);
  const extendBudget = useCallback((newTotal: number) =>
    dispatch({ type: 'UPDATE_BUDGET', payload: { total: newTotal } }), []);
  const setActiveProject = useCallback((projectId: string) =>
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId }), []);
  const addProject = useCallback((project: Project) =>
    dispatch({ type: 'ADD_PROJECT', payload: project }), []);
  const updateProject = useCallback((projectId: string, changes: Partial<Project>) =>
    dispatch({ type: 'UPDATE_PROJECT', payload: { projectId, changes } }), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId) ?? null;

  return (
    <HiveContext.Provider value={{
      state,
      activeProject,
      dispatch,
      toggleSession, dismissAlert, dismissNotification,
      markNotificationRead, markAllNotificationsRead,
      updateTaskStatus, setAgentStatus, extendBudget,
      setActiveProject, addProject, updateProject,
    }}>
      {children}
    </HiveContext.Provider>
  );
}

export function useHive() {
  const ctx = useContext(HiveContext);
  if (!ctx) throw new Error('useHive must be used within HiveProvider');
  return ctx;
}
