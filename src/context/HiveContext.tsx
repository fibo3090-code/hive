import React, { createContext, useContext, useReducer, useCallback, type Dispatch } from 'react';
import {
  mockAgents, mockTasks, mockAlerts, mockSession,
  type Agent, type TaskItem, type AlertItem, type SessionInfo, type AgentStatus,
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
  agents: Agent[];
  tasks: TaskItem[];
  alerts: AlertItem[];
  notifications: Notification[];
  activeProjectId: string | null;
  healthScore: number;
}

const initialState: HiveState = {
  session: { ...mockSession },
  agents: [...mockAgents],
  tasks: [...mockTasks],
  alerts: [...mockAlerts],
  notifications: initialNotifications,
  activeProjectId: 'proj-001',
  healthScore: 87,
};

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
      return { ...state, activeProjectId: action.payload };

    case 'SET_HEALTH_SCORE':
      return { ...state, healthScore: action.payload };

    default:
      return state;
  }
}

/* ─── Context ─── */
interface HiveContextValue {
  state: HiveState;
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
}

const HiveContext = createContext<HiveContextValue | null>(null);

export function HiveProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(hiveReducer, initialState);

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

  return (
    <HiveContext.Provider value={{
      state, dispatch,
      toggleSession, dismissAlert, dismissNotification,
      markNotificationRead, markAllNotificationsRead,
      updateTaskStatus, setAgentStatus, extendBudget,
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
