import { useState } from 'react';
import { useHive } from '@/context/HiveContext';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import {
  Heart, DollarSign, FileCheck, TestTube2, Bot,
  AlertTriangle, AlertCircle, Info, XCircle,
  ChevronDown, ChevronRight, GitCommit, Clock,
  Eye, FileText, Check, X, Play, Pause,
  CheckCircle2, Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { AlertItem } from '@/data/mockData';

interface DashAlert {
  id: string;
  severity: AlertSev;
  title: string;
  message: string;
  timestamp: string;
  actionLabel?: string;
  dismissed: boolean;
}

const severityConfig = {
  critical: { icon: XCircle, border: 'border-l-destructive', bg: 'bg-destructive/5', text: 'text-destructive' },
  high: { icon: AlertTriangle, border: 'border-l-warning', bg: 'bg-warning/5', text: 'text-warning' },
  medium: { icon: AlertCircle, border: 'border-l-info', bg: 'bg-info/5', text: 'text-info' },
  info: { icon: Info, border: 'border-l-muted-foreground', bg: 'bg-muted/5', text: 'text-muted-foreground' },
};

const statusTaskColors: Record<string, string> = {
  'in-progress': 'text-success',
  queued: 'text-muted-foreground',
  completed: 'text-primary',
  blocked: 'text-destructive',
};

const mockCommits = [
  { hash: 'a3f2c1d', message: 'feat: implement dashboard summary tiles', author: 'Frontend Architect', time: '5 min ago' },
  { hash: 'b8e4f2a', message: 'feat: add auth middleware with JWT', author: 'Backend Engineer', time: '12 min ago' },
  { hash: 'c1d5e3b', message: 'test: add integration tests for auth', author: 'QA Sentinel', time: '18 min ago' },
  { hash: 'd2f6a4c', message: 'docs: update API reference', author: 'Doc Writer', time: '25 min ago' },
];

const mockActivityFeed = [
  { id: 'f1', icon: Bot, text: 'Frontend Architect started task: Build dashboard', time: '2 min ago', type: 'agent' },
  { id: 'f2', icon: GitCommit, text: 'Backend Engineer committed: auth middleware', time: '12 min ago', type: 'commit' },
  { id: 'f3', icon: AlertTriangle, text: 'Loop detected in Doc Writer — paused automatically', time: '15 min ago', type: 'alert' },
  { id: 'f4', icon: TestTube2, text: 'QA Sentinel: 87/94 tests passing', time: '20 min ago', type: 'test' },
  { id: 'f5', icon: FileText, text: 'Spec drift detected in section §3.3', time: '25 min ago', type: 'drift' },
  { id: 'f6', icon: DollarSign, text: 'Budget checkpoint: $142/$200 consumed', time: '30 min ago', type: 'budget' },
  { id: 'f7', icon: Eye, text: 'Planning Engine reviewed PR #12', time: '35 min ago', type: 'review' },
  { id: 'f8', icon: Bot, text: 'Security Auditor paused — awaiting credentials', time: '40 min ago', type: 'agent' },
];

const initialAlerts: DashAlert[] = [
  { id: 'alert-1', severity: 'critical', title: 'Budget threshold reached', message: 'Project budget at 89% — 3 agents throttled', timestamp: '2 min ago', actionLabel: 'Extend Budget', dismissed: false },
  { id: 'alert-2', severity: 'high', title: 'Agent loop detected', message: 'Doc Writer has repeated the same action 4 times', timestamp: '8 min ago', actionLabel: 'Intervene', dismissed: false },
  { id: 'alert-3', severity: 'medium', title: 'Spec drift detected', message: 'Implementation diverged from PRD section 4.2', timestamp: '23 min ago', dismissed: false },
  { id: 'alert-4', severity: 'info', title: 'New eval results', message: 'QA Sentinel completed batch evaluation — 94% pass rate', timestamp: '45 min ago', dismissed: false },
];

/* ─── Sprint Timeline (Redesigned) ─── */
function SprintTimeline() {
  const totalDays = 14;
  const currentDay = 6;
  const progressPct = (currentDay / totalDays) * 100;

  const tasks = [
    { name: 'Setup & Config', start: 0, end: 3, status: 'completed' as const, assignee: 'Planning Engine' },
    { name: 'Auth Middleware', start: 2, end: 7, status: 'in-progress' as const, assignee: 'Backend Engineer' },
    { name: 'Dashboard UI', start: 4, end: 9, status: 'in-progress' as const, assignee: 'Frontend Architect' },
    { name: 'API Docs', start: 5, end: 8, status: 'blocked' as const, assignee: 'Doc Writer' },
    { name: 'Test Suite', start: 6, end: 11, status: 'in-progress' as const, assignee: 'QA Sentinel' },
    { name: 'Security Audit', start: 8, end: 12, status: 'queued' as const, assignee: 'Security Auditor' },
    { name: 'Deploy & QA', start: 11, end: 14, status: 'queued' as const, assignee: 'Planning Engine' },
  ];

  const statusColors = {
    completed: 'bg-success/70 border-success/50',
    'in-progress': 'bg-primary/60 border-primary/40',
    blocked: 'bg-destructive/50 border-destructive/40',
    queued: 'bg-muted/40 border-border',
  };

  const statusIcons = {
    completed: CheckCircle2,
    'in-progress': Play,
    blocked: Pause,
    queued: Circle,
  };

  const dates = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(2026, 3, 1 + i * 2);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Sprint 3 Timeline</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
            Day {currentDay}/{totalDays}
          </span>
        </div>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success/70" /> Done</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/60" /> Active</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive/50" /> Blocked</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted/40" /> Queued</span>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* Date axis */}
        <div className="flex ml-[140px] mb-2">
          {dates.map((d, i) => (
            <span key={i} className="text-micro text-muted-foreground/60 font-mono" style={{ width: `${100 / 8}%` }}>{d}</span>
          ))}
        </div>

        {/* Task rows */}
        <div className="space-y-1.5">
          {tasks.map((task) => {
            const StatusIcon = statusIcons[task.status];
            const leftPct = (task.start / totalDays) * 100;
            const widthPct = ((task.end - task.start) / totalDays) * 100;

            return (
              <div key={task.name} className="flex items-center group">
                <div className="w-[140px] shrink-0 flex items-center gap-2 pr-3">
                  <StatusIcon className={cn('h-3 w-3 shrink-0',
                    task.status === 'completed' ? 'text-success' :
                    task.status === 'in-progress' ? 'text-primary' :
                    task.status === 'blocked' ? 'text-destructive' : 'text-muted-foreground'
                  )} />
                  <span className="text-micro text-muted-foreground truncate">{task.name}</span>
                </div>
                <div className="flex-1 relative h-6">
                  <div
                    className={cn(
                      'absolute top-0.5 bottom-0.5 rounded-sm border transition-all cursor-pointer',
                      'hover:brightness-125 hover:shadow-sm',
                      statusColors[task.status]
                    )}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${task.name} — ${task.assignee}`}
                  >
                    <span className="text-[9px] font-medium text-foreground/80 px-1.5 leading-5 truncate block">
                      {task.assignee}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Now indicator line */}
        <div className="relative ml-[140px] mt-1">
          <div className="absolute top-0 h-1 w-px" style={{ left: `${progressPct}%` }}>
            <div className="absolute -top-[calc(100%+0.5rem)] bottom-0 w-px bg-primary" style={{ height: `${tasks.length * 28 + 8}px`, transform: 'translateY(-100%)' }} />
            <span className="absolute -top-3 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary-foreground whitespace-nowrap">
              Now
            </span>
          </div>
        </div>

        {/* Overall progress */}
        <div className="mt-4 ml-[140px] flex items-center gap-3">
          <Progress value={45} className="h-1.5 flex-1" />
          <span className="text-micro font-mono text-muted-foreground">45% complete</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Background Session Card ─── */
function BackgroundSessionCard() {
  const [paused, setPaused] = useState(false);
  const navigate = useNavigate();

  return (
    <div className={cn('rounded-lg border p-4 transition-colors', paused ? 'border-warning/20 bg-warning/5' : 'border-primary/20 bg-primary/5')}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn('h-2 w-2 rounded-full', paused ? 'bg-warning' : 'bg-primary animate-status-pulse')} />
          <h3 className={cn('text-sm font-semibold', paused ? 'text-warning' : 'text-primary')}>
            {paused ? 'Session Paused' : 'Background Session Active'}
          </h3>
        </div>
        <span className="text-micro font-mono text-primary">01:23:45</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>4 agents {paused ? 'paused' : 'working'}</span>
        <span>342K tokens</span>
        <span>$142 spent</span>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => navigate('/dashboard')} className="text-xs text-primary hover:underline">View Wake Report</button>
        <button onClick={() => { setPaused(!paused); toast(paused ? 'Session resumed' : 'Session paused'); }} className={cn('text-xs hover:underline', paused ? 'text-success' : 'text-muted-foreground')}>
          {paused ? 'Resume Session' : 'Pause Session'}
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [timeFilter, setTimeFilter] = useState('1h');
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [showMoreActivity, setShowMoreActivity] = useState(false);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [tasks, setTasks] = useState(mockTasks);

  const activeAlerts = alerts.filter(a => !a.dismissed);
  const budgetUsed = 142;
  const budgetTotal = 200;
  const budgetPct = Math.round((budgetUsed / budgetTotal) * 100);
  const displayedActivity = showMoreActivity ? mockActivityFeed : mockActivityFeed.slice(0, 5);

  const dismissAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
    toast.success('Alert dismissed');
  };

  const handleAlertAction = (alert: DashAlert) => {
    if (alert.actionLabel === 'Extend Budget') {
      toast.success('Budget extended to $300');
    } else if (alert.actionLabel === 'Intervene') {
      toast.success('Doc Writer agent paused and restarted');
    }
    dismissAlert(alert.id);
  };

  const toggleTaskStatus = (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next = t.status === 'queued' ? 'in-progress' : t.status === 'in-progress' ? 'completed' : t.status;
      if (next !== t.status) toast.success(`Task "${t.title}" → ${next}`);
      return { ...t, status: next };
    }));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Alert banners */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setAlertsExpanded(!alertsExpanded)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {alertsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {activeAlerts.length} Alerts
          </button>
          <AnimatePresence>
            {alertsExpanded && activeAlerts.map((alert) => {
              const config = severityConfig[alert.severity];
              const Icon = config.icon;
              return (
                <motion.div key={alert.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className={cn('flex items-center gap-3 rounded-md border-l-4 px-4 py-2.5', config.border, config.bg)}>
                  <Icon className={cn('h-4 w-4 shrink-0', config.text)} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{alert.title}</span>
                    <span className="text-xs text-muted-foreground ml-2">{alert.message}</span>
                  </div>
                  <span className="text-micro text-muted-foreground">{alert.timestamp}</span>
                  {alert.actionLabel && (
                    <button onClick={() => handleAlertAction(alert)} className="text-xs font-medium text-primary hover:underline">{alert.actionLabel}</button>
                  )}
                  <button onClick={() => dismissAlert(alert.id)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Health Score', value: '87', icon: Heart, color: 'text-success', sub: '+2 from last session', path: '/insights' },
          { label: 'Budget', value: `$${budgetUsed}/$${budgetTotal}`, icon: DollarSign, color: budgetPct > 80 ? 'text-warning' : 'text-foreground', sub: `${budgetPct}% consumed`, path: '/settings' },
          { label: 'Spec Completion', value: '73%', icon: FileCheck, color: 'text-info', sub: '22/30 requirements', path: '/spec' },
          { label: 'Test Coverage', value: '68%', icon: TestTube2, color: 'text-primary', sub: '87/94 passing', path: '/insights' },
          { label: 'Active Agents', value: `${mockAgents.filter(a => a.status === 'working').length}/${mockAgents.length}`, icon: Bot, color: 'text-primary', sub: '1 blocked, 1 paused', path: '/hive-graph' },
        ].map((tile) => (
          <motion.div key={tile.label} whileHover={{ scale: 1.02 }} onClick={() => navigate(tile.path)}
            className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{tile.label}</span>
              <tile.icon className={cn('h-4 w-4', tile.color)} />
            </div>
            <span className={cn('text-xl font-semibold font-mono', tile.color)}>{tile.value}</span>
            <p className="text-micro text-muted-foreground mt-1">{tile.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Active alert chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'high').map(a => (
          <button key={a.id} onClick={() => handleAlertAction(a)}
            className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium transition-colors hover:opacity-80', a.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
            {a.severity === 'critical' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {a.title}
          </button>
        ))}
      </div>

      {/* Sprint timeline */}
      <SprintTimeline />

      <div className="grid grid-cols-3 gap-6">
        {/* Active tasks */}
        <div className="col-span-2 space-y-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Active Tasks</h3>
              <span className="text-micro text-muted-foreground">{tasks.length} tasks</span>
            </div>
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors group">
                  <button
                    onClick={() => toggleTaskStatus(task.id)}
                    className={cn('h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors',
                      task.status === 'completed' ? 'bg-success/20 border-success text-success' :
                      task.status === 'in-progress' ? 'border-primary text-primary' :
                      task.status === 'blocked' ? 'border-destructive text-destructive' : 'border-border hover:border-primary'
                    )}
                  >
                    {task.status === 'completed' && <Check className="h-3 w-3" />}
                    {task.status === 'in-progress' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                    {task.status === 'blocked' && <X className="h-3 w-3" />}
                  </button>
                  <span className={cn('text-xs font-medium w-24 capitalize', statusTaskColors[task.status])}>{task.status}</span>
                  <span className={cn('text-sm flex-1 truncate', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.title}</span>
                  <span className={cn('text-micro px-1.5 py-0.5 rounded', task.priority === 'high' ? 'bg-destructive/10 text-destructive' : task.priority === 'medium' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')}>{task.priority}</span>
                  <span className="text-xs text-muted-foreground">{task.assignee}</span>
                  <span className="text-micro font-mono text-muted-foreground">{(task.estimatedTokens / 1000).toFixed(0)}k tok</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent commits */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Recent Commits</h3>
              <button onClick={() => navigate('/code')} className="text-micro text-primary hover:underline">View all</button>
            </div>
            <div className="divide-y divide-border">
              {mockCommits.map(c => (
                <div key={c.hash} onClick={() => navigate('/code')} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors cursor-pointer">
                  <GitCommit className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-sm flex-1 truncate">{c.message}</span>
                  <span className="text-micro font-mono text-muted-foreground">{c.hash}</span>
                  <span className="text-micro text-muted-foreground">{c.author}</span>
                  <span className="text-micro text-muted-foreground">{c.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent cards */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Agents</h3>
              <button onClick={() => navigate('/hive-graph')} className="text-micro text-primary hover:underline">{mockAgents.length} total</button>
            </div>
            <div className="p-3 space-y-2 max-h-[360px] overflow-auto scrollbar-thin">
              {mockAgents.map((agent) => (
                <motion.div key={agent.id} whileHover={{ scale: 1.01 }}
                  onClick={() => navigate('/hive-graph')}
                  className={cn(
                    'rounded-md border bg-surface-2 p-3 cursor-pointer hover:border-primary/30 transition-colors',
                    agent.status === 'working' ? 'border-success/30' :
                    agent.status === 'blocked' ? 'border-destructive/30' :
                    agent.status === 'paused' ? 'border-warning/30' : 'border-border'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusDot status={agent.status} size="sm" />
                    <span className="text-sm font-medium truncate">{agent.name}</span>
                    <span className="text-micro text-muted-foreground ml-auto font-mono">{agent.model}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mb-2">{agent.currentTask}</p>
                  <div className="flex items-center gap-2">
                    <ConfidenceBar value={agent.qualityScore} className="flex-shrink-0" />
                    <span className="text-micro font-mono text-muted-foreground">{agent.qualityScore}%</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Background session */}
          <BackgroundSessionCard />
        </div>
      </div>

      {/* Activity feed */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Activity Feed</h3>
          <div className="flex gap-1">
            {['1h', '6h', '24h'].map((t) => (
              <button key={t} onClick={() => setTimeFilter(t)} className={cn('rounded px-2 py-0.5 text-micro transition-colors', t === timeFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border">
          {displayedActivity.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors cursor-pointer">
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">{item.text}</span>
                <span className="text-micro text-muted-foreground">{item.time}</span>
              </div>
            );
          })}
        </div>
        {!showMoreActivity && mockActivityFeed.length > 5 && (
          <button onClick={() => setShowMoreActivity(true)} className="w-full py-2 text-xs text-primary hover:underline border-t border-border">
            Load more ({mockActivityFeed.length - 5} more)
          </button>
        )}
      </div>
    </div>
  );
}
