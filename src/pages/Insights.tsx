import { useState } from 'react';
import { cn } from '@/lib/utils';
import { mockAgents } from '@/data/mockData';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import { StatusDot } from '@/components/shared/StatusDot';
import { BarChart3, Trophy, Brain, Activity, BookOpen, Bug, PlayCircle, ChevronRight, ChevronDown, Search, Download, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, CartesianGrid, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { motion } from 'framer-motion';

const tabs = [
  { id: 'agent', label: 'Agent Metrics', icon: BarChart3 },
  { id: 'project', label: 'Project Metrics', icon: Activity },
  { id: 'leaderboard', label: 'Eval Leaderboard', icon: Trophy },
  { id: 'traces', label: 'Langfuse Traces', icon: Brain },
  { id: 'hivemind', label: 'Hive Mind', icon: BookOpen },
  { id: 'techdebt', label: 'Tech Debt', icon: Bug },
  { id: 'replay', label: 'Session Replay', icon: PlayCircle },
] as const;

const chartStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' };
const qualityData = mockAgents.map(a => ({ name: a.name.split(' ')[0], quality: a.qualityScore, tokens: Math.round(a.tokensUsed / 1000) }));
const timelineData = Array.from({ length: 12 }, (_, i) => ({ time: `${i * 5}m`, quality: 75 + Math.random() * 20, cost: 5 + Math.random() * 15, latency: 1 + Math.random() * 3 }));
const tokenDistribution = mockAgents.map(a => ({ name: a.name.split(' ')[0], value: a.tokensUsed }));
const COLORS = ['hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--info))', 'hsl(var(--warning))', 'hsl(var(--destructive))', 'hsl(var(--chart-4))'];
const scatterData = mockAgents.map(a => ({ name: a.name, quality: a.qualityScore, cost: Math.round(a.tokensUsed / 1000 * 0.003 * 100) / 100, tokens: a.tokensUsed }));
const latencyData = [
  { model: 'GPT-4o', p50: 1.8, p95: 3.2, p99: 5.1 },
  { model: 'Claude 3.5', p50: 2.1, p95: 3.8, p99: 5.8 },
  { model: 'Gemini Pro', p50: 1.5, p95: 2.9, p99: 4.2 },
];
const successData = mockAgents.map(a => ({ name: a.name.split(' ')[0], rate: 80 + Math.random() * 18 }));

export default function Insights() {
  const [tab, setTab] = useState('agent');

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors', tab === t.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {tab === 'agent' && <AgentMetrics />}
        {tab === 'project' && <ProjectMetrics />}
        {tab === 'leaderboard' && <EvalLeaderboard />}
        {tab === 'traces' && <LangfuseTraces />}
        {tab === 'hivemind' && <HiveMindBoard />}
        {tab === 'techdebt' && <TechDebtBoard />}
        {tab === 'replay' && <SessionReplay />}
      </div>
    </div>
  );
}

function AgentMetrics() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Agent Metrics</h2>
      <div className="grid grid-cols-4 gap-3">
        {[{ label: 'Avg Quality', value: '88%' }, { label: 'Total Tokens', value: '442K' }, { label: 'Avg Latency', value: '2.3s' }, { label: 'Success Rate', value: '94%' }].map(k => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">{k.label}</span><span className="block text-lg font-semibold font-mono mt-1">{k.value}</span></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Quality by Agent">
          <ResponsiveContainer width="100%" height={200}><BarChart data={qualityData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Bar dataKey="quality" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Quality Over Time">
          <ResponsiveContainer width="100%" height={200}><LineChart data={timelineData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="cost" stroke="hsl(var(--info))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Token Distribution">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart><Pie data={tokenDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}>
              {tokenDistribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie><RechartsTooltip contentStyle={chartStyle} /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Latency by Model">
          <ResponsiveContainer width="100%" height={200}><BarChart data={latencyData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="model" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Bar dataKey="p50" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} /><Bar dataKey="p95" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} /><Bar dataKey="p99" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Success Rate">
          <ResponsiveContainer width="100%" height={200}><BarChart data={successData}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis domain={[70, 100]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Bar dataKey="rate" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Cost Efficiency">
          <ResponsiveContainer width="100%" height={200}><ScatterChart><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="cost" name="Cost ($)" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis dataKey="quality" name="Quality (%)" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Scatter data={scatterData} fill="hsl(var(--primary))" /></ScatterChart></ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2 font-medium">Agent</th><th className="text-left px-4 py-2 font-medium">Model</th><th className="text-left px-4 py-2 font-medium">Quality</th><th className="text-left px-4 py-2 font-medium">Tokens</th><th className="text-left px-4 py-2 font-medium">Cost</th><th className="text-left px-4 py-2 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-border">
            {mockAgents.map(a => (
              <tr key={a.id} className="hover:bg-surface-2/50"><td className="px-4 py-2 font-medium">{a.name}</td><td className="px-4 py-2 font-mono text-muted-foreground">{a.model}</td><td className="px-4 py-2"><div className="flex items-center gap-2"><ConfidenceBar value={a.qualityScore} /><span className="font-mono">{a.qualityScore}%</span></div></td><td className="px-4 py-2 font-mono text-muted-foreground">{(a.tokensUsed / 1000).toFixed(0)}K</td><td className="px-4 py-2 font-mono text-muted-foreground">${(a.tokensUsed / 1000 * 0.003).toFixed(2)}</td><td className="px-4 py-2"><StatusDot status={a.status} size="sm" /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectMetrics() {
  const projectTimeline = Array.from({ length: 10 }, (_, i) => ({ day: `Day ${i + 1}`, lines: Math.round(200 + Math.random() * 600), tests: Math.round(5 + Math.random() * 15), cost: Math.round(10 + Math.random() * 30) }));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Project Metrics</h2>
        <button className="flex items-center gap-1 text-xs text-primary hover:underline"><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Total Cost', value: '$142' }, { label: 'Lines Written', value: '4,821' }, { label: 'Files Modified', value: '38' }, { label: 'Tests Passing', value: '87/94' }, { label: 'Spec Coverage', value: '73%' }, { label: 'Session Duration', value: '1h 23m' }].map(k => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">{k.label}</span><span className="block text-lg font-semibold font-mono mt-1">{k.value}</span></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Lines of Code Over Time">
          <ResponsiveContainer width="100%" height={200}><AreaChart data={projectTimeline}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Area type="monotone" dataKey="lines" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.1} /></AreaChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Daily Cost">
          <ResponsiveContainer width="100%" height={200}><BarChart data={projectTimeline}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Bar dataKey="cost" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Tests Added Per Day">
          <ResponsiveContainer width="100%" height={200}><BarChart data={projectTimeline}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Bar dataKey="tests" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Cumulative Progress">
          <ResponsiveContainer width="100%" height={200}><LineChart data={projectTimeline.map((d, i) => ({ ...d, cumLines: projectTimeline.slice(0, i + 1).reduce((s, x) => s + x.lines, 0) }))}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><RechartsTooltip contentStyle={chartStyle} /><Line type="monotone" dataKey="cumLines" stroke="hsl(var(--info))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function EvalLeaderboard() {
  const sorted = [...mockAgents].sort((a, b) => b.qualityScore - a.qualityScore);
  const podium = sorted.slice(0, 3);
  const evalData = (a: typeof mockAgents[0]) => [
    { metric: 'Correctness', value: a.evalScores.correctness },
    { metric: 'Style', value: a.evalScores.style },
    { metric: 'Efficiency', value: a.evalScores.efficiency },
    { metric: 'Testing', value: a.evalScores.testQuality },
    { metric: 'Docs', value: a.evalScores.docQuality },
  ];
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Eval Leaderboard</h2>
      <div className="flex items-end justify-center gap-4 pb-4">
        {[podium[1], podium[0], podium[2]].map((a, i) => {
          const rank = i === 0 ? 2 : i === 1 ? 1 : 3;
          const heights = { 1: 'h-28', 2: 'h-20', 3: 'h-16' };
          const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
          return (
            <motion.div key={a.id} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.1 }} className="flex flex-col items-center">
              <span className="text-lg mb-1">{medals[rank as 1|2|3]}</span>
              <span className="text-xs font-medium mb-1">{a.name}</span>
              <span className="text-lg font-bold font-mono text-primary mb-1">{a.qualityScore}%</span>
              <div className={cn('w-20 rounded-t-md bg-primary/10 border border-primary/20 flex items-center justify-center', heights[rank as 1|2|3])}>
                <Trophy className={cn('h-5 w-5', rank === 1 ? 'text-primary' : 'text-muted-foreground')} />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Router recommendation */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h4 className="text-xs font-semibold text-primary mb-1">🤖 Router Recommendation</h4>
        <p className="text-xs text-muted-foreground">Based on eval scores, consider routing complex tasks to <span className="text-primary font-medium">{podium[0].name}</span> (highest quality) and simple tasks to <span className="text-primary font-medium">{sorted[sorted.length - 1].name}</span> (cost-efficient).</p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left px-4 py-2 font-medium">#</th><th className="text-left px-4 py-2 font-medium">Agent</th><th className="text-left px-4 py-2 font-medium">Score</th><th className="text-left px-4 py-2 font-medium">Correctness</th><th className="text-left px-4 py-2 font-medium">Style</th><th className="text-left px-4 py-2 font-medium">Efficiency</th><th className="text-left px-4 py-2 font-medium">Testing</th><th className="text-left px-4 py-2 font-medium">Docs</th><th className="w-8"></th>
          </tr></thead>
          <tbody className="divide-y divide-border">
            {sorted.map((a, i) => (
              <>
                <tr key={a.id} className="hover:bg-surface-2/50 cursor-pointer" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                  <td className="px-4 py-2 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{a.name}</td>
                  <td className="px-4 py-2 font-mono text-primary">{a.qualityScore}%</td>
                  <td className="px-4 py-2 font-mono">{a.evalScores.correctness}%</td>
                  <td className="px-4 py-2 font-mono">{a.evalScores.style}%</td>
                  <td className="px-4 py-2 font-mono">{a.evalScores.efficiency}%</td>
                  <td className="px-4 py-2 font-mono">{a.evalScores.testQuality}%</td>
                  <td className="px-4 py-2 font-mono">{a.evalScores.docQuality}%</td>
                  <td className="px-4 py-2">{expanded === a.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                </tr>
                {expanded === a.id && (
                  <tr key={`${a.id}-radar`}><td colSpan={9} className="p-4 bg-surface-2/30">
                    <ResponsiveContainer width="100%" height={200}>
                      <RadarChart data={evalData(a)}><PolarGrid stroke="hsl(var(--border))" /><PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><PolarRadiusAxis tick={false} domain={[0, 100]} /><Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} /></RadarChart>
                    </ResponsiveContainer>
                  </td></tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LangfuseTraces() {
  const [selectedSession, setSelectedSession] = useState('session-1');
  const [expandedTrace, setExpandedTrace] = useState<string | null>('t1');
  const traces = [
    { id: 't1', name: 'Planning Engine → Sprint Planning', duration: '3.2s', tokens: 4500, status: 'success', children: [
      { id: 't1-1', name: 'LLM Call: GPT-4o', duration: '2.8s', tokens: 3200, prompt: 'Plan sprint tasks based on...', completion: 'Here is the sprint plan...', promptVersion: 'v3.2' },
      { id: 't1-2', name: 'Tool: TaskAssignment', duration: '0.4s', tokens: 1300, prompt: '', completion: '' },
    ]},
    { id: 't2', name: 'Frontend Architect → Dashboard Build', duration: '5.1s', tokens: 8200, status: 'success', children: [
      { id: 't2-1', name: 'LLM Call: Claude 3.5', duration: '4.2s', tokens: 6800, prompt: 'Create dashboard component...', completion: 'export function Dashboard...', promptVersion: 'v2.1' },
      { id: 't2-2', name: 'Tool: FileWrite', duration: '0.3s', tokens: 400, prompt: '', completion: '' },
      { id: 't2-3', name: 'Tool: EvalCheck', duration: '0.6s', tokens: 1000, prompt: '', completion: '' },
    ]},
    { id: 't3', name: 'QA Sentinel → Test Execution', duration: '2.1s', tokens: 3100, status: 'error', children: [
      { id: 't3-1', name: 'LLM Call: Claude 3.5', duration: '1.5s', tokens: 2400, prompt: 'Generate tests for...', completion: 'describe("auth", () => {...', promptVersion: 'v1.8' },
      { id: 't3-2', name: 'Tool: TestRunner', duration: '0.6s', tokens: 700, prompt: '', completion: 'FAIL: 2 tests failed' },
    ]},
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Langfuse Traces</h2>
        <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)} className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs">
          <option value="session-1">Current Session (01:23:45)</option>
          <option value="session-2">Previous Session (Mar 31)</option>
        </select>
      </div>
      <div className="space-y-2">
        {traces.map(trace => (
          <div key={trace.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <button onClick={() => setExpandedTrace(expandedTrace === trace.id ? null : trace.id)} className="flex items-center gap-3 w-full px-4 py-3 hover:bg-surface-2/50 transition-colors text-left">
              {expandedTrace === trace.id ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <div className={cn('h-2 w-2 rounded-full', trace.status === 'success' ? 'bg-success' : 'bg-destructive')} />
              <span className="text-sm font-medium flex-1">{trace.name}</span>
              <span className="text-micro font-mono text-muted-foreground">{trace.duration}</span>
              <span className="text-micro font-mono text-muted-foreground">{trace.tokens} tok</span>
            </button>
            {expandedTrace === trace.id && (
              <div className="border-t border-border">
                {trace.children.map(child => (
                  <div key={child.id} className="border-b border-border last:border-0">
                    <div className="flex items-center gap-3 px-4 py-2 pl-10 hover:bg-surface-2/30">
                      <span className="text-xs flex-1">{child.name}</span>
                      <span className="text-micro font-mono text-muted-foreground">{child.duration}</span>
                      <span className="text-micro font-mono text-muted-foreground">{child.tokens} tok</span>
                      {child.promptVersion && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">{child.promptVersion}</span>}
                    </div>
                    {child.prompt && (
                      <div className="px-10 pb-2 space-y-1">
                        <div className="rounded border border-border bg-surface-2 p-2"><span className="text-micro text-muted-foreground block mb-1">Prompt:</span><span className="text-xs font-mono">{child.prompt}</span></div>
                        {child.completion && <div className="rounded border border-border bg-surface-2 p-2"><span className="text-micro text-muted-foreground block mb-1">Completion:</span><span className="text-xs font-mono">{child.completion}</span></div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HiveMindBoard() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const categories = ['all', 'Architecture', 'Decisions', 'Patterns', 'Issues', 'Auto-generated'];
  const notes = [
    { id: 'n1', category: 'Architecture', title: 'Authentication Flow', content: 'JWT with httpOnly cookies. Refresh token rotation every 15 min. Rate limiting: 100 req/min per user.\n\n**Decision**: Using RS256 over HS256 for key rotation support.', auto: false, author: 'Backend Engineer', time: '25 min ago' },
    { id: 'n2', category: 'Decisions', title: 'Database Schema v2', content: 'Migrated from flat user table to normalized structure:\n- `users` → core identity\n- `user_profiles` → extended data\n- `user_sessions` → active sessions\n\nReason: Query performance degraded at >10K rows.', auto: false, author: 'Backend Engineer', time: '1 hr ago' },
    { id: 'n3', category: 'Patterns', title: 'Error Handling Pattern', content: 'All API calls use `Result<T, E>` wrapper. Components receive typed errors. Toast notifications for user-facing errors, console.error for internal.\n\n```ts\ntype Result<T, E> = { ok: true; data: T } | { ok: false; error: E };\n```', auto: false, author: 'Frontend Architect', time: '2 hr ago' },
    { id: 'n4', category: 'Auto-generated', title: 'Recurring Pattern: Auth Checks', content: 'Detected 12 occurrences of manual auth checks across route handlers. **Suggestion**: Extract to middleware.', auto: true, author: 'System', time: '15 min ago' },
    { id: 'n5', category: 'Issues', title: 'WebSocket Timeout', content: 'WebSocket connections timeout after 30s of inactivity. Need heartbeat mechanism. Affecting 2/5 integration tests.', auto: false, author: 'QA Sentinel', time: '45 min ago' },
  ];
  const filtered = notes.filter(n => (category === 'all' || n.category === category) && (search === '' || n.title.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Hive Mind Board</h2>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="w-full h-8 rounded-md border border-border bg-surface-2 pl-8 pr-3 text-xs placeholder:text-muted-foreground" placeholder="Search notes..." />
        </div>
        <div className="flex gap-1">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)} className={cn('rounded-full px-2.5 py-1 text-micro capitalize', category === c ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>{c}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {filtered.map(note => (
          <div key={note.id} className={cn('rounded-lg border bg-card p-4 hover:border-primary/30 cursor-pointer transition-colors', note.auto ? 'border-primary/20' : 'border-border')}>
            <div className="flex items-center gap-2 mb-2">
              {note.auto && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">auto</span>}
              <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{note.category}</span>
              <span className="text-micro text-muted-foreground ml-auto">{note.time}</span>
            </div>
            <h4 className="text-sm font-semibold mb-2">{note.title}</h4>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{note.content}</div>
            <div className="mt-2 text-micro text-muted-foreground">— {note.author}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TechDebtBoard() {
  const debtItems = [
    { id: 'd1', title: 'Refactor auth module', severity: 'high' as const, file: 'src/lib/auth.ts', description: 'Monolithic auth file needs splitting into separate concerns', lines: 450, impact: 'High coupling, hard to test' },
    { id: 'd2', title: 'Update deprecated APIs', severity: 'medium' as const, file: 'src/lib/api.ts', description: 'Using deprecated fetch patterns — switch to new API client', lines: 120, impact: 'Will break in next major version' },
    { id: 'd3', title: 'Add error boundaries', severity: 'medium' as const, file: 'src/App.tsx', description: 'No error boundaries in component tree', lines: 0, impact: 'Uncaught errors crash entire app' },
    { id: 'd4', title: 'Optimize re-renders', severity: 'low' as const, file: 'src/components/', description: 'Multiple unnecessary re-renders detected via profiler', lines: 0, impact: 'Performance degradation on large datasets' },
    { id: 'd5', title: 'Remove dead code', severity: 'low' as const, file: 'src/utils/', description: '14 unused utility functions detected', lines: 280, impact: 'Bundle size, maintenance burden' },
  ];
  const cols = ['high', 'medium', 'low'] as const;
  const colColors = { high: 'text-destructive', medium: 'text-warning', low: 'text-info' };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Tech Debt Board</h2>
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Total Items', value: debtItems.length.toString() }, { label: 'Critical', value: debtItems.filter(d => d.severity === 'high').length.toString() }, { label: 'Est. Lines', value: debtItems.reduce((s, d) => s + d.lines, 0).toString() }].map(k => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-3"><span className="text-micro text-muted-foreground">{k.label}</span><span className="block text-lg font-semibold font-mono mt-1">{k.value}</span></div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {cols.map(col => (
          <div key={col}>
            <h4 className={cn('text-xs font-semibold uppercase mb-3', colColors[col])}>{col} Priority</h4>
            <div className="space-y-2">
              {debtItems.filter(d => d.severity === col).map(item => (
                <motion.div key={item.id} whileHover={{ scale: 1.01 }} className="rounded-lg border border-border bg-card p-3 hover:border-primary/30 cursor-pointer transition-colors">
                  <h5 className="text-sm font-medium mb-1">{item.title}</h5>
                  <p className="text-micro text-muted-foreground mb-1">{item.description}</p>
                  <p className="text-micro text-muted-foreground italic mb-1">Impact: {item.impact}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-micro font-mono text-muted-foreground">{item.file}</span>
                    {item.lines > 0 && <span className="text-micro text-muted-foreground">{item.lines} lines</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionReplay() {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(35);
  const [speed, setSpeed] = useState(1);
  const events = [
    { time: '00:00', type: 'start', text: 'Session started', color: 'bg-primary' },
    { time: '00:05', type: 'agent', text: 'Planning Engine began sprint planning', color: 'bg-success' },
    { time: '00:12', type: 'agent', text: 'Frontend Architect started dashboard', color: 'bg-info' },
    { time: '00:18', type: 'alert', text: 'Loop detected in Doc Writer', color: 'bg-warning' },
    { time: '00:25', type: 'commit', text: 'Backend Engineer committed auth middleware', color: 'bg-success' },
    { time: '00:35', type: 'alert', text: 'Budget at 71%', color: 'bg-warning' },
    { time: '00:45', type: 'agent', text: 'QA Sentinel began testing', color: 'bg-info' },
    { time: '01:00', type: 'error', text: '2 WebSocket tests failed', color: 'bg-destructive' },
    { time: '01:15', type: 'commit', text: 'Frontend Architect submitted PR #12', color: 'bg-success' },
    { time: '01:23', type: 'current', text: 'Current position', color: 'bg-primary' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Session Replay</h2>
        <select className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs">
          <option>Current Session (01:23:45)</option>
          <option>Session Mar 31 (2:15:00)</option>
        </select>
      </div>

      {/* Playback controls */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <button className="text-muted-foreground hover:text-foreground"><SkipBack className="h-4 w-4" /></button>
          <button onClick={() => setPlaying(!playing)} className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button className="text-muted-foreground hover:text-foreground"><SkipForward className="h-4 w-4" /></button>
          <div className="flex gap-1 ml-4">
            {[0.5, 1, 2, 4].map(s => (
              <button key={s} onClick={() => setSpeed(s)} className={cn('px-2 py-0.5 text-micro rounded', speed === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>{s}x</button>
            ))}
          </div>
          <span className="text-xs font-mono text-muted-foreground ml-auto">{events[Math.floor(progress / 10)]?.time || '00:00'} / 01:23</span>
        </div>

        {/* Scrubber */}
        <div className="relative h-6 bg-surface-2 rounded overflow-hidden cursor-pointer" onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setProgress(Math.round((e.clientX - rect.left) / rect.width * 100)); }}>
          {events.map((ev, i) => (
            <div key={i} className={cn('absolute top-1 w-1.5 h-4 rounded-full', ev.color)} style={{ left: `${(i / (events.length - 1)) * 100}%` }} />
          ))}
          <div className="absolute top-0 bottom-0 bg-primary/20 rounded-l" style={{ width: `${progress}%` }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${progress}%` }} />
        </div>
      </div>

      {/* Split view */}
      <div className="grid grid-cols-2 gap-4">
        {/* Graph snapshot */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-xs font-semibold mb-3">Graph State at {events[Math.floor(progress / 10)]?.time || '00:00'}</h4>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm" style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-md border border-primary/30 bg-card px-3 py-2 text-xs glow-amber">Planning Engine</div>
              <div className="flex gap-4">
                {['Frontend', 'Backend', 'QA'].map(a => (
                  <div key={a} className="rounded-md border border-border bg-card px-3 py-2 text-micro">{a}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Event log */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">Event Log</div>
          <div className="max-h-[240px] overflow-auto scrollbar-thin divide-y divide-border">
            {events.map((ev, i) => (
              <div key={i} className={cn('flex items-center gap-3 px-4 py-2 text-xs', progress / 10 >= i ? '' : 'opacity-30')}>
                <div className={cn('h-2 w-2 rounded-full shrink-0', ev.color)} />
                <span className="font-mono text-muted-foreground w-12">{ev.time}</span>
                <span className="flex-1">{ev.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="text-xs font-semibold mb-3">{title}</h4>
      {children}
    </div>
  );
}
