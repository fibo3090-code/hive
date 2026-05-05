import { useMemo, useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';
import {
  useActivityFeedData,
  useAgentTokenUsageData,
  useCostTimelineData,
  useSprintsData,
  useTaskDistributionData,
} from '@/api/queries/useServerData';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import {
  Heart, DollarSign, FileCheck, TestTube2, Bot,
  AlertTriangle, AlertCircle, Info, XCircle,
  ChevronDown, ChevronRight, GitCommit,
  Eye, FileText, Check, X, Play, Pause,
  CheckCircle2, Circle, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ActivityFeedItem, AlertItem, TaskItem } from '@/types/domain';
import { WakeReportModal } from '@/components/modals/WakeReportModal';
import { BudgetExtensionModal } from '@/components/modals/BudgetExtensionModal';
import { LoopDetectionModal } from '@/components/modals/LoopDetectionModal';
import { CostForecastModal } from '@/components/modals/CostForecastModal';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

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

const commitFeed: Array<{ hash: string; message: string; author: string; time: string }> = [];
const activityIcons = { Bot, GitCommit, AlertTriangle, TestTube2, FileText, DollarSign, Eye } as const;
type ActivityFeedEntry = ActivityFeedItem & { activityIcon: LucideIcon };

/* Real-aggregate Token Usage Timeline / Agent Tokens / Task Status are
   computed inside the Dashboard component from the insight endpoints. */

/* ─── Sprint Timeline ─── */
type GanttStatus = 'completed' | 'in-progress' | 'blocked' | 'queued';
function SprintTimeline({
  projectId,
  tasks: allTasks,
}: {
  readonly projectId: string | null | undefined;
  readonly tasks: TaskItem[];
}) {
  const sprintsQuery = useSprintsData(projectId);
  const activeSprint =
    sprintsQuery.data?.find((s) => s.status === 'active') ??
    sprintsQuery.data?.[0] ??
    null;

  if (!activeSprint) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        {sprintsQuery.isLoading ? 'Loading sprint…' : 'No active sprint. Plan one in /spec to populate the timeline.'}
      </div>
    );
  }

  const startIso = activeSprint.startDate ?? activeSprint.start_date ?? null;
  const endIso = activeSprint.endDate ?? activeSprint.end_date ?? null;
  const startDate = startIso ? new Date(startIso) : null;
  const endDate = endIso ? new Date(endIso) : null;
  // Sprint duration in days; fall back to a sensible default when the
  // backend has no dates so the gantt still renders something.
  const totalDays =
    startDate && endDate
      ? Math.max(
          1,
          Math.round((endDate.getTime() - startDate.getTime()) / 86400000),
        )
      : 14;
  const today = new Date();
  const currentDay =
    startDate
      ? Math.max(
          0,
          Math.min(totalDays, Math.round((today.getTime() - startDate.getTime()) / 86400000)),
        )
      : 0;
  const progressPct = totalDays > 0 ? (currentDay / totalDays) * 100 : 0;

  const sprintTasks = allTasks.filter((t) => t.sprintId === activeSprint.id);
  // Distribute tasks evenly across the sprint window when their own
  // start/end aren't tracked. This is a best-effort visual; the
  // task-distribution chart remains the authoritative shape.
  const ganttRows = sprintTasks.length > 0
    ? sprintTasks.map((task, idx, all) => {
        const slice = totalDays / Math.max(1, all.length);
        const start = Math.round(idx * slice);
        const end = Math.min(totalDays, Math.round((idx + 1) * slice));
        const status = (task.status as GanttStatus) ?? 'queued';
        return { name: task.title, start, end, status, assignee: task.assignee };
      })
    : [];

  const statusColors: Record<GanttStatus, string> = {
    completed: 'bg-success/70 border-success/50',
    'in-progress': 'bg-primary/60 border-primary/40',
    blocked: 'bg-destructive/50 border-destructive/40',
    queued: 'bg-muted/40 border-border',
  };
  const statusIcons: Record<GanttStatus, typeof CheckCircle2> = {
    completed: CheckCircle2,
    'in-progress': Play,
    blocked: Pause,
    queued: Circle,
  };
  // 8 evenly-spaced date labels across the sprint window. When dates
  // are missing, fall back to "Day 0", "Day 2", ... so the chart is
  // still readable.
  const dates =
    startDate
      ? Array.from({ length: 8 }, (_, i) => {
          const d = new Date(
            startDate.getTime() + (i * totalDays * 86400000) / 8,
          );
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        })
      : Array.from({ length: 8 }, (_, i) => `Day ${Math.round((i * totalDays) / 8)}`);
  const sprintTitle = activeSprint.name || `Sprint ${activeSprint.position ?? ''}`.trim();
  const sprintProgressPct =
    typeof activeSprint.progress === 'number' ? activeSprint.progress : Math.round(progressPct);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">{sprintTitle} Timeline</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">Day {currentDay}/{totalDays}</span>
        </div>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success/70" /> Done</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/60" /> Active</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive/50" /> Blocked</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted/40" /> Queued</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="flex ml-[140px] mb-2">
          {dates.map((d) => <span key={d} className="text-micro text-muted-foreground/60 font-mono" style={{ width: `${100 / 8}%` }}>{d}</span>)}
        </div>
        <div className="space-y-1.5">
          {ganttRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-micro text-muted-foreground">
              No tasks scheduled in this sprint yet.
            </div>
          ) : (
            ganttRows.map((task) => {
              const StatusIcon = statusIcons[task.status];
              const leftPct = (task.start / totalDays) * 100;
              const widthPct = ((task.end - task.start) / totalDays) * 100;
              const ganttStatusColorMap: Record<string, string> = { completed: 'text-success', 'in-progress': 'text-primary', blocked: 'text-destructive' };
              const ganttStatusColor = ganttStatusColorMap[task.status] ?? 'text-muted-foreground';
              return (
                <div key={`${task.name}-${task.start}`} className="flex items-center group">
                  <div className="w-[140px] shrink-0 flex items-center gap-2 pr-3">
                    <StatusIcon className={cn('h-3 w-3 shrink-0', ganttStatusColor)} />
                    <span className="text-micro text-muted-foreground truncate">{task.name}</span>
                  </div>
                  <div className="flex-1 relative h-6">
                    <div className={cn('absolute top-0.5 bottom-0.5 rounded-sm border transition-all cursor-pointer hover:brightness-125 hover:shadow-sm', statusColors[task.status])} style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${task.name} — ${task.assignee}`}>
                      <span className="text-[9px] font-medium text-foreground/80 px-1.5 leading-5 truncate block">{task.assignee}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="relative ml-[140px] mt-1">
          <div className="absolute top-0 h-1 w-px" style={{ left: `${progressPct}%` }}>
            <div className="absolute -top-[calc(100%+0.5rem)] bottom-0 w-px bg-primary" style={{ height: `${Math.max(1, ganttRows.length) * 28 + 8}px`, transform: 'translateY(-100%)' }} />
            <span className="absolute -top-3 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary-foreground whitespace-nowrap">Now</span>
          </div>
        </div>
        <div className="mt-4 ml-[140px] flex items-center gap-3">
          <Progress value={sprintProgressPct} className="h-1.5 flex-1" />
          <span className="text-micro font-mono text-muted-foreground">{sprintProgressPct}% complete</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Background Session Card ─── */
function BackgroundSessionCard({ onViewWakeReport }: { readonly onViewWakeReport: () => void }) {
  const { state, toggleSession } = useHiveData();
  const { session, agents } = state;
  const workingCount = agents.filter(a => a.status === 'working').length;
  return (
    <div className={cn('rounded-lg border p-4 transition-colors', session.isActive ? 'border-primary/20 bg-primary/5' : 'border-warning/20 bg-warning/5')}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={cn('h-2 w-2 rounded-full', session.isActive ? 'bg-primary animate-status-pulse' : 'bg-warning')} />
          <h3 className={cn('text-sm font-semibold', session.isActive ? 'text-primary' : 'text-warning')}>{session.isActive ? 'Background Session Active' : 'Session Paused'}</h3>
        </div>
        <span className="text-micro font-mono text-primary">{session.elapsed}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{workingCount} agents {session.isActive ? 'working' : 'paused'}</span>
        <span>{(session.tokensUsed / 1000).toFixed(0)}K tokens</span>
        <span>${session.budgetUsed} spent</span>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={onViewWakeReport} className="text-xs text-primary hover:underline">View Wake Report</button>
        <button onClick={() => { toggleSession(); toast(session.isActive ? 'Session paused' : 'Session resumed'); }} className={cn('text-xs hover:underline', session.isActive ? 'text-muted-foreground' : 'text-success')}>{session.isActive ? 'Pause Session' : 'Resume Session'}</button>
      </div>
    </div>
  );
}

/* ─── Custom Tooltip ─── */
type ChartTooltipEntry = {
  dataKey: string;
  value: number | string;
  color?: string;
  stroke?: string;
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  readonly active?: boolean;
  readonly payload?: ChartTooltipEntry[];
  readonly label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      {payload.map((p) => {
        const unitSuffix = (() => {
          if (p.dataKey === 'tokens') return 'K';
          if (p.dataKey === 'cost') return '$';
          return '';
        })();
        return (
          <div key={p.dataKey} className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{p.dataKey}:</span>
            <span className="font-mono font-semibold">{p.value}{unitSuffix}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { state, activeProject, dismissAlert: ctxDismissAlert, updateTaskStatus } = useHiveData();
  const { data: activityFeedRaw = [] } = useActivityFeedData(activeProject?.id);
  const { agents, tasks, alerts, session, healthScore } = state;
  const [timeFilter, setTimeFilter] = useState('1h');

  // Live insight aggregates. The `range` matches the segmented control
  // above the timeline; `bucket` is chosen to give ~10–20 points across
  // the chart for any range.
  const insightRange = timeFilter === '1h' ? '1h' : timeFilter === '24h' ? '24h' : '7d';
  const insightBucket =
    timeFilter === '1h' ? '5m' : timeFilter === '24h' ? '1h' : '6h';
  const { data: costTimelineRaw = [] } = useCostTimelineData(
    activeProject?.id,
    insightRange,
    insightBucket,
  );
  const { data: agentTokenRaw = [] } = useAgentTokenUsageData(
    activeProject?.id,
    insightRange,
  );
  const { data: taskDistributionRaw = [] } = useTaskDistributionData(activeProject?.id);

  const tokenTimelineData = useMemo(
    () =>
      costTimelineRaw.map((point) => {
        const dt = new Date(point.time);
        const hh = dt.getHours().toString().padStart(2, '0');
        const mm = dt.getMinutes().toString().padStart(2, '0');
        return { time: `${hh}:${mm}`, tokens: point.tokens, cost: point.cents };
      }),
    [costTimelineRaw],
  );

  const agentColors = [
    'hsl(var(--primary))',
    'hsl(var(--success))',
    'hsl(var(--info))',
    'hsl(var(--warning))',
    'hsl(var(--destructive))',
    'hsl(var(--muted-foreground))',
  ];
  const agentTokenData = useMemo(() => {
    return agentTokenRaw.slice(0, 6).map((row, idx) => {
      const agent = agents.find((a) => a.id === row.agentId);
      return {
        name: agent?.name ?? row.agentId,
        tokens: row.tokens,
        color: agentColors[idx % agentColors.length],
      };
    });
  }, [agentTokenRaw, agents]);

  const taskStatusColors: Record<string, string> = {
    completed: 'hsl(var(--success))',
    'in-progress': 'hsl(var(--primary))',
    in_progress: 'hsl(var(--primary))',
    blocked: 'hsl(var(--destructive))',
    queued: 'hsl(var(--muted-foreground))',
    todo: 'hsl(var(--muted-foreground))',
    pending: 'hsl(var(--muted-foreground))',
  };
  const taskStatusData = useMemo(
    () =>
      taskDistributionRaw.map((row) => ({
        name: row.status
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        value: row.count,
        color:
          taskStatusColors[row.status.toLowerCase()] ??
          'hsl(var(--muted-foreground))',
      })),
    [taskDistributionRaw],
  );
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [showMoreActivity, setShowMoreActivity] = useState(false);

  // Modal states
  const [wakeReportOpen, setWakeReportOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [loopModalOpen, setLoopModalOpen] = useState(false);
  const [costForecastOpen, setCostForecastOpen] = useState(false);

  const budgetUsed = session.budgetUsed;
  const budgetTotal = session.budgetTotal;
  const budgetPct = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
  const activityFeed: ActivityFeedEntry[] = activityFeedRaw.map((item) => ({
    ...item,
    activityIcon: activityIcons[item.icon as keyof typeof activityIcons] ?? Bot,
  }));
  const displayedActivity = showMoreActivity ? activityFeed : activityFeed.slice(0, 5);
  const specCompletion = activeProject?.specCompletion ?? 73;
  const testCoverage = activeProject?.testCoverage ?? 68;

  const dismissAlert = (id: string) => { ctxDismissAlert(id); toast.success('Alert dismissed'); };

  const handleAlertAction = (alert: AlertItem) => {
    if (alert.actionLabel === 'Extend Budget') {
      setBudgetModalOpen(true);
    } else if (alert.actionLabel === 'Intervene') {
      setLoopModalOpen(true);
    }
  };

  const toggleTaskStatus = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nextIfInProgress = task.status === 'in-progress' ? 'completed' : task.status;
    const next = task.status === 'queued' ? 'in-progress' : nextIfInProgress;
    if (next !== task.status) { updateTaskStatus(id, next); toast.success(`Task "${task.title}" → ${next}`); }
  };

  const activeAlerts = alerts;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Modals */}
      <WakeReportModal open={wakeReportOpen} onOpenChange={setWakeReportOpen} />
      <BudgetExtensionModal open={budgetModalOpen} onOpenChange={setBudgetModalOpen} />
      <LoopDetectionModal open={loopModalOpen} onOpenChange={setLoopModalOpen} />
      <CostForecastModal open={costForecastOpen} onOpenChange={setCostForecastOpen} />

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
                  <button onClick={() => dismissAlert(alert.id)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Health Score', value: String(healthScore), icon: Heart, color: 'text-success', sub: '+2 from last session', path: '/insights' },
          { label: 'Budget', value: `$${budgetUsed}/$${budgetTotal}`, icon: DollarSign, color: budgetPct > 80 ? 'text-warning' : 'text-foreground', sub: `${budgetPct}% consumed`, path: '/settings' },
          { label: 'Spec Completion', value: `${specCompletion}%`, icon: FileCheck, color: 'text-info', sub: `${activeProject?.name ?? 'Project'} requirements`, path: '/spec' },
          { label: 'Test Coverage', value: `${testCoverage}%`, icon: TestTube2, color: 'text-primary', sub: '87/94 passing', path: '/insights' },
          { label: 'Active Agents', value: `${agents.filter(a => a.status === 'working').length}/${agents.length}`, icon: Bot, color: 'text-primary', sub: `${agents.filter(a => a.status === 'blocked').length} blocked, ${agents.filter(a => a.status === 'paused').length} paused`, path: '/hive-graph' },
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

      {/* Active alert chips + cost forecast button */}
      <div className="flex items-center gap-2 flex-wrap">
        {activeAlerts.filter(a => a.severity === 'critical' || a.severity === 'high').map(a => (
          <button key={a.id} onClick={() => handleAlertAction(a)}
            className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium transition-colors hover:opacity-80', a.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
            {a.severity === 'critical' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {a.title}
          </button>
        ))}
        <button onClick={() => setCostForecastOpen(true)} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-micro font-medium bg-primary/10 text-primary hover:bg-primary/20">
          <Zap className="h-3 w-3" /> Cost Forecast
        </button>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Token usage over time */}
        <div className="col-span-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Token & Cost Timeline</h3>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={tokenTimelineData}>
              <defs>
                <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="tokens" stroke="hsl(var(--primary))" fill="url(#tokenGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="cost" stroke="hsl(var(--warning))" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Task status pie */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Task Distribution</h3>
          <ResponsiveContainer width="100%" height={120}>
            <PieChart>
              <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={3}>
                {taskStatusData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-2 justify-center">
            {taskStatusData.map(d => (
              <span key={d.name} className="flex items-center gap-1 text-micro text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Agent token bar chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Token Usage by Agent (K)</h3>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={agentTokenData} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={70} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
              {agentTokenData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sprint timeline */}
      <SprintTimeline projectId={activeProject?.id ?? null} tasks={tasks} />

      <div className="grid grid-cols-3 gap-6">
        {/* Active tasks */}
        <div className="col-span-2 space-y-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Active Tasks</h3>
              <span className="text-micro text-muted-foreground">{tasks.length} tasks</span>
            </div>
            <div className="divide-y divide-border">
              {tasks.map((task) => {
                const taskButtonColorIfBlocked = task.status === 'blocked' ? 'border-destructive text-destructive' : 'border-border hover:border-primary';
                const taskButtonColorIfInProgress = task.status === 'in-progress' ? 'border-primary text-primary' : taskButtonColorIfBlocked;
                const taskButtonColor = task.status === 'completed' ? 'bg-success/20 border-success text-success' : taskButtonColorIfInProgress;
                const taskPriorityColorIfMedium = task.priority === 'medium' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground';
                const taskPriorityColor = task.priority === 'high' ? 'bg-destructive/10 text-destructive' : taskPriorityColorIfMedium;
                return (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors group">
                    <button onClick={() => toggleTaskStatus(task.id)}
                      className={cn('h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors', taskButtonColor)}>
                      {task.status === 'completed' && <Check className="h-3 w-3" />}
                      {task.status === 'in-progress' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      {task.status === 'blocked' && <X className="h-3 w-3" />}
                    </button>
                    <span className={cn('text-xs font-medium w-24 capitalize', statusTaskColors[task.status])}>{task.status}</span>
                    <span className={cn('text-sm flex-1 truncate', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.title}</span>
                    <span className={cn('text-micro px-1.5 py-0.5 rounded', taskPriorityColor)}>{task.priority}</span>
                    <span className="text-xs text-muted-foreground">{task.assignee}</span>
                    <span className="text-micro font-mono text-muted-foreground">{((task.estimatedTokens ?? 0) / 1000).toFixed(0)}k tok</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent commits */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Recent Commits</h3>
              <button onClick={() => navigate('/code')} className="text-micro text-primary hover:underline">View all</button>
            </div>
            <div className="divide-y divide-border">
              {commitFeed.length === 0 ? (
                <div className="px-4 py-4 text-xs text-muted-foreground">Git integration not configured</div>
              ) : commitFeed.map(c => (
                <button
                  type="button"
                  key={c.hash}
                  onClick={() => navigate('/code')}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors cursor-pointer w-full text-left"
                >
                  <GitCommit className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-sm flex-1 truncate">{c.message}</span>
                  <span className="text-micro font-mono text-muted-foreground">{c.hash}</span>
                  <span className="text-micro text-muted-foreground">{c.author}</span>
                  <span className="text-micro text-muted-foreground">{c.time}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Agent cards */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Agents</h3>
              <button onClick={() => navigate('/hive-graph')} className="text-micro text-primary hover:underline">{agents.length} total</button>
            </div>
            <div className="p-3 space-y-2 max-h-[360px] overflow-auto scrollbar-thin">
              {agents.map((agent) => {
                const qualityScore = agent.qualityScore ?? 0;
                const agentBorderIfPaused = agent.status === 'paused' ? 'border-warning/30' : 'border-border';
                const agentBorderIfBlocked = agent.status === 'blocked' ? 'border-destructive/30' : agentBorderIfPaused;
                const agentBorderColor = agent.status === 'working' ? 'border-success/30' : agentBorderIfBlocked;
                return (
                <motion.div key={agent.id} whileHover={{ scale: 1.01 }} onClick={() => navigate('/hive-graph')}
                  className={cn('rounded-md border bg-surface-2 p-3 cursor-pointer hover:border-primary/30 transition-colors', agentBorderColor)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusDot status={agent.status} size="sm" />
                    <span className="text-sm font-medium truncate">{agent.name}</span>
                    <span className="text-micro text-muted-foreground ml-auto font-mono">{agent.model}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mb-2">{agent.currentTask}</p>
                  <div className="flex items-center gap-2">
                    <ConfidenceBar value={qualityScore} className="flex-shrink-0" />
                    <span className="text-micro font-mono text-muted-foreground">{qualityScore}%</span>
                  </div>
                </motion.div>
                );
              })}
            </div>
          </div>
          <BackgroundSessionCard onViewWakeReport={() => setWakeReportOpen(true)} />
        </div>
      </div>

      {/* Activity feed */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Activity Feed</h3>
          <div className="flex gap-1">
            {['1h', '6h', '24h'].map((t) => (
              <button key={t} onClick={() => setTimeFilter(t)} className={cn('rounded px-2 py-0.5 text-micro transition-colors', t === timeFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>{t}</button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border">
          {displayedActivity.map((item) => {
            const Icon = item.activityIcon;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors cursor-pointer">
                <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">{item.text ?? item.title ?? 'Activity item'}</span>
                <span className="text-micro text-muted-foreground">{item.time ?? item.createdAt ?? 'just now'}</span>
              </div>
            );
          })}
        </div>
        {!showMoreActivity && activityFeed.length > 5 && (
          <button onClick={() => setShowMoreActivity(true)} className="w-full py-2 text-xs text-primary hover:underline border-t border-border">
            Load more ({activityFeed.length - 5} more)
          </button>
        )}
      </div>
    </div>
  );
}
