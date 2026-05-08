import { useMemo, useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';
import {
  useActivityFeedData,
  useAgentTokenUsageData,
  useCostTimelineData,
  useTaskDistributionData,
} from '@/api/queries/useServerData';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertBanners } from '@/components/layout/dashboard/AlertBanners';
import { DashboardMetrics } from '@/components/layout/dashboard/DashboardMetrics';
import { ActiveTasks } from '@/components/layout/dashboard/ActiveTasks';
import { AgentCards } from '@/components/layout/dashboard/AgentCards';
import { ActivityFeed } from '@/components/layout/dashboard/ActivityFeed';
import { SprintTimeline } from '@/components/layout/dashboard/SprintTimeline';
import { BackgroundSessionCard } from '@/components/layout/dashboard/BackgroundSessionCard';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';

export default function Dashboard() {
  const navigate = useNavigate();
  const { state, activeProject } = useHiveData();
  const { alerts, tasks, agents } = state;
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const [showMoreActivity, setShowMoreActivity] = useState(false);
  const [activityTimeFilter, setActivityTimeFilter] = useState('24h');

  const { data: activityFeed = [] } = useActivityFeedData(activeProject?.id);
  const { data: costTimeline = [] } = useCostTimelineData(activeProject?.id);
  const { data: taskDistribution = [] } = useTaskDistributionData(activeProject?.id);
  const { data: agentTokenUsage = [] } = useAgentTokenUsageData(activeProject?.id);

  const budgetTotal = 250;
  const budgetUsed = state.session.budgetUsed;
  const healthScore = state.session.healthScore;

  const handleToggleTaskStatus = (_id: string, _status: string) => {
    // In a real app, this would be a mutation call
  };

  const handleDismissAlert = (id: string) => {
    toast.info(`Alert ${id} dismissed`);
  };

  const handleAlertAction = (alert: any) => {
    if (alert.actionPath) navigate(alert.actionPath);
  };

  return (
    <div className="h-full overflow-auto scrollbar-thin p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Overview</h1>
          <p className="text-muted-foreground">Real-time performance and agent orchestration status.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/forge')} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">Forge Agent</button>
        </div>
      </div>

      <AlertBanners
        alerts={alerts}
        expanded={alertsExpanded}
        onToggleExpand={() => setAlertsExpanded(!alertsExpanded)}
        onDismiss={handleDismissAlert}
        onAction={handleAlertAction}
      />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <DashboardMetrics
            healthScore={healthScore}
            budgetUsed={budgetUsed}
            budgetTotal={budgetTotal}
            activeProject={activeProject}
            agents={agents}
            onNavigate={navigate}
          />

          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-4">Cost Timeline</h3>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={costTimeline}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="time" hide />
                    <YAxis hide />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', fontSize: '10px' }} />
                    <Area type="monotone" dataKey="cost" stroke="var(--primary)" fillOpacity={1} fill="url(#colorCost)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold mb-4">Task Distribution</h3>
              <div className="h-[200px] w-full">
                <PieChart width={200} height={200}>
                  <Pie data={taskDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {taskDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </div>
            </div>
          </div>

          <SprintTimeline projectId={activeProject?.id} tasks={tasks} />
        </div>

        <div className="space-y-6">
          <BackgroundSessionCard onViewWakeReport={() => navigate('/session-history')} />
          <AgentCards agents={agents} onNavigate={navigate} />
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-4">Token Usage by Agent</h3>
            <div className="h-[180px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agentTokenUsage} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={60} style={{ fontSize: '10px' }} />
                  <Tooltip />
                  <Bar dataKey="tokens" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <ActiveTasks tasks={tasks} onToggleStatus={handleToggleTaskStatus} />
        <ActivityFeed
          activity={activityFeed}
          timeFilter={activityTimeFilter}
          onTimeFilterChange={setActivityTimeFilter}
          showMore={showMoreActivity}
          onToggleShowMore={() => setShowMoreActivity(!showMoreActivity)}
        />
      </div>
    </div>
  );
}
