export type AgentStatus = 'working' | 'idle' | 'blocked' | 'paused' | 'deprecated';
export type SovereigntyTier = 'local' | 'hybrid' | 'cloud';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: AgentStatus;
  currentTask: string;
  qualityScore: number;
  tokensUsed: number;
  evalScores: { correctness: number; style: number; efficiency: number; testQuality: number; docQuality: number };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  healthScore: number;
  agentCount: number;
  budget: { used: number; total: number };
  specCompletion: number;
  testCoverage: number;
  sovereigntyTier: SovereigntyTier;
  status: 'active' | 'paused' | 'completed';
  lastActivity: string;
}

export interface SessionInfo {
  isActive: boolean;
  agentCount: number;
  elapsed: string;
  tokensUsed: number;
  budgetUsed: number;
  budgetTotal: number;
}

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: string;
  source: string;
  actionLabel?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  assignee: string;
  status: 'in-progress' | 'queued' | 'completed' | 'blocked';
  phase: string;
  priority: 'high' | 'medium' | 'low';
  estimatedTokens: number;
}

export const mockAgents: Agent[] = [
  { id: 'pe-001', name: 'Planning Engine', role: 'Coordinator', model: 'GPT-4o', status: 'working', currentTask: 'Orchestrating sprint 3 tasks', qualityScore: 94, tokensUsed: 125000, evalScores: { correctness: 95, style: 90, efficiency: 88, testQuality: 92, docQuality: 91 } },
  { id: 'fe-001', name: 'Frontend Architect', role: 'Frontend', model: 'Claude 3.5', status: 'working', currentTask: 'Building dashboard components', qualityScore: 91, tokensUsed: 98000, evalScores: { correctness: 92, style: 95, efficiency: 85, testQuality: 88, docQuality: 87 } },
  { id: 'be-001', name: 'Backend Engineer', role: 'Backend', model: 'GPT-4o', status: 'idle', currentTask: 'Waiting for API spec review', qualityScore: 89, tokensUsed: 112000, evalScores: { correctness: 90, style: 85, efficiency: 92, testQuality: 90, docQuality: 86 } },
  { id: 'qa-001', name: 'QA Sentinel', role: 'Testing', model: 'Claude 3.5', status: 'working', currentTask: 'Running integration tests', qualityScore: 93, tokensUsed: 45000, evalScores: { correctness: 96, style: 88, efficiency: 90, testQuality: 98, docQuality: 85 } },
  { id: 'sec-001', name: 'Security Auditor', role: 'Security', model: 'GPT-4o', status: 'paused', currentTask: 'Paused — awaiting credentials', qualityScore: 87, tokensUsed: 34000, evalScores: { correctness: 94, style: 82, efficiency: 86, testQuality: 85, docQuality: 90 } },
  { id: 'doc-001', name: 'Doc Writer', role: 'Documentation', model: 'Gemini Pro', status: 'blocked', currentTask: 'Blocked on missing API types', qualityScore: 85, tokensUsed: 28000, evalScores: { correctness: 82, style: 92, efficiency: 80, testQuality: 78, docQuality: 96 } },
];

export const mockProjects: Project[] = [
  { id: 'proj-001', name: 'HIVE Dashboard', description: 'Internal agent management dashboard', healthScore: 87, agentCount: 6, budget: { used: 142, total: 200 }, specCompletion: 73, testCoverage: 68, sovereigntyTier: 'hybrid', status: 'active', lastActivity: '2 min ago' },
  { id: 'proj-002', name: 'API Gateway v2', description: 'Microservices gateway refactor', healthScore: 92, agentCount: 4, budget: { used: 85, total: 150 }, specCompletion: 91, testCoverage: 82, sovereigntyTier: 'local', status: 'active', lastActivity: '15 min ago' },
  { id: 'proj-003', name: 'ML Pipeline', description: 'Data processing and model training pipeline', healthScore: 64, agentCount: 3, budget: { used: 178, total: 200 }, specCompletion: 55, testCoverage: 41, sovereigntyTier: 'cloud', status: 'active', lastActivity: '1 hr ago' },
];

export const mockSession: SessionInfo = {
  isActive: true,
  agentCount: 4,
  elapsed: '01:23:45',
  tokensUsed: 342000,
  budgetUsed: 142,
  budgetTotal: 200,
};

export const mockAlerts: AlertItem[] = [
  { id: 'alert-1', severity: 'critical', title: 'Budget threshold reached', message: 'Project budget at 89% — 3 agents throttled', timestamp: '2 min ago', source: 'Budget Monitor', actionLabel: 'Extend Budget' },
  { id: 'alert-2', severity: 'high', title: 'Agent loop detected', message: 'Doc Writer has repeated the same action 4 times', timestamp: '8 min ago', source: 'Loop Detector', actionLabel: 'Intervene' },
  { id: 'alert-3', severity: 'medium', title: 'Spec drift detected', message: 'Implementation diverged from PRD section 4.2', timestamp: '23 min ago', source: 'Spec Monitor' },
  { id: 'alert-4', severity: 'info', title: 'New eval results', message: 'QA Sentinel completed batch evaluation — 94% pass rate', timestamp: '45 min ago', source: 'Eval Engine' },
];

export const mockTasks: TaskItem[] = [
  { id: 'task-1', title: 'Implement auth middleware', assignee: 'Backend Engineer', status: 'in-progress', phase: 'Sprint 3', priority: 'high', estimatedTokens: 15000 },
  { id: 'task-2', title: 'Build dashboard summary tiles', assignee: 'Frontend Architect', status: 'in-progress', phase: 'Sprint 3', priority: 'high', estimatedTokens: 12000 },
  { id: 'task-3', title: 'Write API documentation', assignee: 'Doc Writer', status: 'blocked', phase: 'Sprint 3', priority: 'medium', estimatedTokens: 8000 },
  { id: 'task-4', title: 'Security audit — endpoints', assignee: 'Security Auditor', status: 'queued', phase: 'Sprint 3', priority: 'high', estimatedTokens: 20000 },
  { id: 'task-5', title: 'Integration test suite', assignee: 'QA Sentinel', status: 'in-progress', phase: 'Sprint 3', priority: 'medium', estimatedTokens: 10000 },
  { id: 'task-6', title: 'Optimize DB queries', assignee: 'Backend Engineer', status: 'queued', phase: 'Sprint 4', priority: 'low', estimatedTokens: 9000 },
];
