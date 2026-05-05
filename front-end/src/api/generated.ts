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
  /** Provider/model selection used by the runtime (PATCH /v1/agents/:id). */
  modelProviderId?: string | null;
  modelId?: string | null;
  /** Project-relative parent agent (set when spawned via spawn_agent). */
  parentAgentId?: string | null;
  /** Free-text override applied at the start of every turn. */
  systemPrompt?: string | null;
  /** Names of tools this agent may invoke (empty array = inherit defaults). */
  enabledTools?: string[];
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
  type: 'critical' | 'high' | 'medium' | 'info' | 'loop_detected' | string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  actionable?: boolean;
  actionLabel?: string | null;
  /**
   * Structured payload for typed notifications (e.g. `loop_detected`).
   * Shape depends on `type`; consumers should narrow before accessing.
   */
  payload?: Record<string, unknown> | null;
}

export interface NoteItem {
  id: string;
  projectId: string;
  category: 'Architecture' | 'Decisions' | 'Patterns' | 'Issues' | 'Auto-generated' | string;
  title: string;
  content: string;
  auto: boolean;
  author: string;
  time: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TechDebtItem {
  id: string;
  projectId?: string;
  title: string;
  severity: 'high' | 'medium' | 'low' | string;
  file?: string | null;
  description?: string | null;
  lines: number;
  impact?: string | null;
  position?: number;
}

export interface SprintPlanItem {
  id: string;
  projectId?: string;
  name: string;
  status: 'active' | 'planned' | 'completed' | string;
  startDate?: string;
  endDate?: string;
  start_date?: string;
  end_date?: string;
  velocity?: number | null;
  points: number;
  position?: number;
  progress?: number;
  tasks?: number;
  completed?: number;
}

export interface RequirementItem {
  id: string;
  code?: string;
  title: string;
  section?: string;
  status: 'implemented' | 'in-progress' | 'planned' | string;
  description: string;
  driftDetected?: boolean;
  drift?: boolean;
}

export interface UserStoryItem {
  id: string;
  code?: string;
  title: string;
  status: 'done' | 'in-progress' | 'planned' | string;
  sprintLabel?: string;
  sprint?: string;
  points: number;
  acceptanceCriteria: string[];
}

export interface ActivityFeedItem {
  id: string;
  icon?: string;
  text?: string;
  title?: string;
  time?: string;
  type?: string;
  createdAt?: string;
}

export interface TimelinePoint {
  day: string;
  cost?: number;
  completed?: number;
  planning?: number;
  frontend?: number;
  backend?: number;
}

export interface ModuleDependency {
  name: string;
  version?: string;
  required?: boolean;
}

export interface ModuleChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export interface ModuleCatalogItem {
  id: string;
  name: string;
  version: string;
  status: 'installed' | 'available' | string;
  category: 'Core' | 'Community' | 'Project' | string;
  description: string;
  longDescription?: string;
  stars: number;
  downloads: string;
  layers: string[];
  author: string;
  updated: string;
  dependencies?: ModuleDependency[];
  changelog?: ModuleChangelogEntry[];
}

export interface AgentBlueprint {
  id: string;
  name: string;
  role: string;
  model: string;
  description: string;
  traits: string[];
  icon: string;
  dna: Record<string, number>;
}

export interface SessionHistoryPoint {
  t: string;
  cost: number;
}

export interface AgentBreakdownItem {
  name: string;
  tokens: number;
  color: string;
}

export interface SessionHistoryItem {
  id: string;
  date: string;
  startTime: string;
  duration: string;
  status: 'active' | 'completed' | string;
  agentsUsed: number;
  tokensUsed: number;
  cost: number;
  budget: number;
  filesModified: number;
  linesWritten: number;
  tasksCompleted: number;
  tasksTotal: number;
  healthScore: number;
  highlights: string[];
  costTimeline: SessionHistoryPoint[];
  agentBreakdown: AgentBreakdownItem[];
}

export interface components {
  schemas: {
    Agent: Agent;
    Project: Project;
    SessionInfo: SessionInfo;
    AlertItem: AlertItem;
    TaskItem: TaskItem;
    Notification: Notification;
    NoteItem: NoteItem;
    TechDebtItem: TechDebtItem;
    SprintPlanItem: SprintPlanItem;
    RequirementItem: RequirementItem;
    UserStoryItem: UserStoryItem;
    ActivityFeedItem: ActivityFeedItem;
    TimelinePoint: TimelinePoint;
    ModuleCatalogItem: ModuleCatalogItem;
    ModuleDependency: ModuleDependency;
    ModuleChangelogEntry: ModuleChangelogEntry;
    AgentBlueprint: AgentBlueprint;
    SessionHistoryItem: SessionHistoryItem;
    SessionHistoryPoint: SessionHistoryPoint;
    AgentBreakdownItem: AgentBreakdownItem;
  };
}
