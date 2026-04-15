export type AgentStatus = 'working' | 'idle' | 'blocked' | 'paused' | 'deprecated';
export type SovereigntyTier = 'local' | 'hybrid' | 'cloud';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface Agent {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  role: string;
  model: string;
  status: AgentStatus;
  currentTask?: string | null;
  qualityScore?: number | null;
  tokensUsed: number;
  evalScores: { correctness?: number; style?: number; efficiency?: number; testQuality?: number; docQuality?: number };
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  healthScore: number;
  agentCount: number;
  budget: { used: number; total: number };
  specCompletion: number;
  testCoverage: number;
  sovereigntyTier: SovereigntyTier;
  status: 'active' | 'paused' | 'completed';
  lastActivity: string;
  lastActivityAt?: string | null;
}

export interface SessionInfo {
  id?: string | null;
  isActive: boolean;
  agentCount: number;
  elapsed: string;
  tokensUsed: number;
  budgetUsed: number;
  budgetTotal: number;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  source: string;
  actionLabel?: string | null;
  actionKind?: string | null;
}

export interface TaskItem {
  id: string;
  title: string;
  assignee: string;
  status: 'in-progress' | 'queued' | 'completed' | 'blocked';
  phase?: string | null;
  priority: 'high' | 'medium' | 'low';
  estimatedTokens: number;
  agentId?: string | null;
  sprintId?: string | null;
}

export interface Notification {
  id: string;
  type: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  message: string;
  time: string;
  read: boolean;
  actionable?: boolean;
  actionLabel?: string | null;
}

export interface components {
  schemas: {
    Agent: Agent;
    Project: Project;
    SessionInfo: SessionInfo;
    AlertItem: AlertItem;
    TaskItem: TaskItem;
    Notification: Notification;
  };
}
