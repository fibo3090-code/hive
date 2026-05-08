import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Download,
  PlayCircle,
  Trophy,
} from 'lucide-react';
import { useHiveData } from '@/api/queries/useHiveData';
import {
  useActivityFeedData,
  useSpendTimelineData,
  useTaskThroughputData,
} from '@/api/queries/useServerData';
import type { ActivityFeedItem } from '@/types/domain';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const tabs = [
  { id: 'agent', label: 'Agent Metrics', icon: BarChart3 },
  { id: 'project', label: 'Project Metrics', icon: Activity },
  { id: 'leaderboard', label: 'Eval Leaderboard', icon: Trophy },
  { id: 'traces', label: 'Runtime Feed', icon: Brain },
  { id: 'replay', label: 'Session Replay', icon: PlayCircle },
] as const;

type ChartTooltipEntry = {
  dataKey: string;
  value: number | string;
  color?: string;
  stroke?: string;
};

function ChartTooltip({
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
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
          <span className="text-muted-foreground capitalize">{entry.dataKey}:</span>
          <span className="font-mono font-semibold">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export default function Stats() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('agent');

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              tab === item.id
                ? 'bg-primary/10 text-primary border-r-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 space-y-6 animate-fade-in">
        {tab === 'agent' && <AgentMetricsTab />}
        {tab === 'project' && <ProjectMetricsTab />}
        {tab === 'leaderboard' && <LeaderboardTab />}
        {tab === 'traces' && <RuntimeFeedTab />}
        {tab === 'replay' && <SessionReplayTab />}
      </div>
    </div>
  );
}

function AgentMetricsTab() {
  const { state } = useHiveData();
  const agentPerformanceData = useMemo(
    () =>
      state.agents.map((agent) => ({
        name: agent.name.split(' ')[0],
        quality: agent.qualityScore ?? 0,
        tokens: Math.round(agent.tokensUsed / 1000),
      })),
    [state.agents]
  );

  const radarAgents = state.agents.slice(0, 3);
  const radarData = useMemo(() => {
    if (radarAgents.length === 0) return [];

    const metrics = [
      ['Correctness', 'correctness'],
      ['Style', 'style'],
      ['Efficiency', 'efficiency'],
      ['Test Quality', 'testQuality'],
      ['Doc Quality', 'docQuality'],
    ] as const;

    return metrics.map(([label, key]) => ({
      metric: label,
      ...Object.fromEntries(
        radarAgents.map((agent) => [agent.name.split(' ')[0], agent.evalScores?.[key] ?? 0])
      ),
    }));
  }, [radarAgents]);

  const averageQuality =
    state.agents.length > 0
      ? Math.round(state.agents.reduce((sum, agent) => sum + (agent.qualityScore ?? 0), 0) / state.agents.length)
      : 0;
  const totalTokens = state.agents.reduce((sum, agent) => sum + agent.tokensUsed, 0);

  if (state.agents.length === 0) {
    return <EmptyState title="No agent metrics yet" message="Spawn or connect agents to start collecting quality and token data." />;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Agent Metrics</h2>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Avg Quality', value: `${averageQuality}%` },
          { label: 'Total Tokens', value: `${Math.round(totalTokens / 1000)}K` },
          { label: 'Working Agents', value: `${state.agents.filter((agent) => agent.status === 'working').length}` },
          { label: 'Blocked Agents', value: `${state.agents.filter((agent) => agent.status === 'blocked').length}` },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
            <span className="text-micro text-muted-foreground">{tile.label}</span>
            <span className="block text-lg font-semibold font-mono mt-1">{tile.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Quality Score by Agent</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agentPerformanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={30} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="quality" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Eval Scores (Top Agents)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              {radarAgents.map((agent, index) => {
                const colors = ['hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--info))'];
                const key = agent.name.split(' ')[0];
                return (
                  <Radar
                    key={agent.id}
                    name={key}
                    dataKey={key}
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.12}
                  />
                );
              })}
              <Tooltip content={<ChartTooltip />} />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Token Consumption (K)</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={agentPerformanceData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={60} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="tokens" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ProjectMetricsTab() {
  const { activeProject, state } = useHiveData();
  const projectId = activeProject?.id ?? null;
  const spendTimeline = useSpendTimelineData(projectId);
  const throughputTimeline = useTaskThroughputData(projectId);

  const totalSpend = (spendTimeline.data ?? []).reduce((sum, point) => sum + (point.cost ?? 0), 0);
  const totalThroughput = (throughputTimeline.data ?? []).reduce((sum, point) => sum + (point.completed ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Project Metrics</h2>
        <button className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Budget Used', value: `$${state.session.budgetUsed}` },
          { label: 'Budget Total', value: `$${state.session.budgetTotal}` },
          { label: 'Tokens This Session', value: `${Math.round(state.session.tokensUsed / 1000)}K` },
          { label: 'Tasks Completed', value: `${totalThroughput}` },
        ].map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
            <span className="text-micro text-muted-foreground">{tile.label}</span>
            <span className="block text-lg font-semibold font-mono mt-1">{tile.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Spend Over Time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={spendTimeline.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={30} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="cost" stroke="hsl(var(--warning))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Task Throughput</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={throughputTimeline.data ?? []}>
              <defs>
                <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={30} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="completed" stroke="hsl(var(--success))" fill="url(#throughputGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Health Snapshot</h3>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Health Score', value: `${activeProject?.healthScore ?? 0}%` },
            { label: 'Spec Completion', value: `${activeProject?.specCompletion ?? 0}%` },
            { label: 'Test Coverage', value: `${activeProject?.testCoverage ?? 0}%` },
          ].map((tile) => (
            <div key={tile.label} className="rounded-md bg-surface-2 p-3">
              <span className="text-micro text-muted-foreground">{tile.label}</span>
              <span className="block text-base font-semibold font-mono mt-1">{tile.value}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Total recorded spend: ${totalSpend}. Active project: {activeProject?.name ?? 'No project selected'}.
        </p>
      </div>
    </div>
  );
}

function LeaderboardTab() {
  const { state } = useHiveData();
  const sortedAgents = [...state.agents].sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0));

  if (sortedAgents.length === 0) {
    return <EmptyState title="No leaderboard yet" message="Agent evals will appear here as soon as quality metrics are recorded." />;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Eval Leaderboard</h2>
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="text-left px-4 py-2">#</th>
              <th scope="col" className="text-left px-4 py-2">Agent</th>
              <th scope="col" className="text-left px-4 py-2">Role</th>
              <th scope="col" className="text-left px-4 py-2">Quality</th>
              <th scope="col" className="text-left px-4 py-2">Correctness</th>
              <th scope="col" className="text-left px-4 py-2">Style</th>
              <th scope="col" className="text-left px-4 py-2">Efficiency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedAgents.map((agent, index) => (
              <tr key={agent.id} className="hover:bg-surface-2/50">
                <td className="px-4 py-2 font-mono text-muted-foreground">{index + 1}</td>
                <td className="px-4 py-2 font-medium">{agent.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{agent.role}</td>
                <td className="px-4 py-2 font-mono text-primary">{agent.qualityScore ?? 0}%</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{agent.evalScores?.correctness ?? 0}%</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{agent.evalScores?.style ?? 0}%</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{agent.evalScores?.efficiency ?? 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RuntimeFeedTab() {
  const { activeProject } = useHiveData();
  const activity = useActivityFeedData(activeProject?.id);

  if (!activity.data?.length) {
    return <EmptyState title="No runtime feed yet" message="Backend activity and trace-style events will show up here when the project produces them." />;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Runtime Feed</h2>
      <div className="space-y-2">
        {activity.data.map((entry: ActivityFeedItem) => (
          <div key={entry.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-sm font-medium flex-1">{entry.text ?? entry.title ?? 'Activity event'}</span>
            <span className="text-micro font-mono text-muted-foreground">{entry.time ?? entry.createdAt ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionReplayTab() {
  const { activeProject } = useHiveData();
  const activityQuery = useActivityFeedData(activeProject?.id);
  const events = useMemo<ActivityFeedItem[]>(() => activityQuery.data ?? [], [activityQuery.data]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (events.length > 0 && index > events.length - 1) {
      setIndex(events.length - 1);
    }
  }, [events, index]);

  if (!events.length) {
    return <EmptyState title="No replay events yet" message="Activity events will automatically feed the replay timeline when sessions produce them." />;
  }

  const current = events[Math.max(0, index)];
  const progress = events.length <= 1 ? 0 : (index / (events.length - 1)) * 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Session Replay</h2>
        <span className="text-xs text-muted-foreground">{events.length} recorded events</span>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">{current?.text ?? current?.title ?? 'Replay event'}</div>
            <div className="text-micro text-muted-foreground">{current?.time ?? ''}</div>
          </div>
          <div className="text-micro font-mono text-muted-foreground">
            {index + 1}/{events.length}
          </div>
        </div>
        <div className="relative h-5 rounded bg-surface-2 overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-primary/15" style={{ width: `${progress}%` }} />
          {events.map((event: ActivityFeedItem, eventIndex: number) => (
            <button
              key={event.id ?? eventIndex}
              onClick={() => setIndex(eventIndex)}
              className="absolute top-0 h-full w-3 -translate-x-1/2"
              style={{ left: `${(eventIndex / Math.max(1, events.length - 1)) * 100}%` }}
            >
              <span className={cn('block mx-auto mt-1 h-3 w-1.5 rounded-full', eventIndex <= index ? 'bg-primary' : 'bg-border')} />
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-xs font-semibold mb-3">Current Snapshot</h4>
          <div className="h-48 rounded-lg border border-dashed border-border flex items-center justify-center bg-surface-2/40 p-6 text-center">
            <div>
              <Bot className="h-6 w-6 text-primary mx-auto mb-3" />
              <div className="text-sm font-medium mb-1">{current?.text ?? current?.title ?? 'Replay event'}</div>
              <div className="text-xs text-muted-foreground">
                This view is backed by the live project activity stream rather than a hardcoded replay script.
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">Event Log</div>
          <div className="max-h-[240px] overflow-auto scrollbar-thin divide-y divide-border">
            {events.map((event: ActivityFeedItem, eventIndex: number) => (
              <button
                key={event.id ?? eventIndex}
                onClick={() => setIndex(eventIndex)}
                className={cn(
                  'flex items-center gap-3 w-full px-4 py-2 text-xs text-left',
                  eventIndex > index && 'opacity-40'
                )}
              >
                <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                <span className="font-mono text-muted-foreground w-16">{event.time ?? ''}</span>
                <span className="flex-1">{event.text ?? event.title ?? 'Activity event'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
