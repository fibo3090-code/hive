import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Clock, DollarSign, Bot, FileText, ChevronRight, CheckCircle2, AlertTriangle, BarChart3 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

const pastSessions = [
  {
    id: 'ses-005',
    date: 'Apr 14, 2026',
    startTime: '09:15 AM',
    duration: '1h 23m',
    status: 'active' as const,
    agentsUsed: 4,
    tokensUsed: 342000,
    cost: 142,
    budget: 200,
    filesModified: 38,
    linesWritten: 4821,
    tasksCompleted: 5,
    tasksTotal: 12,
    healthScore: 87,
    highlights: ['Dashboard UI completed', 'Auth middleware PR opened', 'Loop detected in Doc Writer'],
    costTimeline: [
      { t: '0m', cost: 0 }, { t: '15m', cost: 28 }, { t: '30m', cost: 52 },
      { t: '45m', cost: 78 }, { t: '60m', cost: 118 }, { t: '75m', cost: 135 }, { t: '83m', cost: 142 },
    ],
    agentBreakdown: [
      { name: 'Planning', tokens: 125, color: 'hsl(var(--primary))' },
      { name: 'Frontend', tokens: 98, color: 'hsl(var(--success))' },
      { name: 'Backend', tokens: 112, color: 'hsl(var(--info))' },
      { name: 'QA', tokens: 45, color: 'hsl(var(--warning))' },
    ],
  },
  {
    id: 'ses-004',
    date: 'Apr 13, 2026',
    startTime: '02:30 PM',
    duration: '2h 15m',
    status: 'completed' as const,
    agentsUsed: 5,
    tokensUsed: 510000,
    cost: 185,
    budget: 200,
    filesModified: 52,
    linesWritten: 7340,
    tasksCompleted: 8,
    tasksTotal: 10,
    healthScore: 82,
    highlights: ['API gateway refactored', 'Test coverage reached 68%', 'Security audit initiated'],
    costTimeline: [
      { t: '0m', cost: 0 }, { t: '20m', cost: 35 }, { t: '40m', cost: 72 },
      { t: '60m', cost: 105 }, { t: '80m', cost: 138 }, { t: '100m', cost: 162 }, { t: '135m', cost: 185 },
    ],
    agentBreakdown: [
      { name: 'Planning', tokens: 140, color: 'hsl(var(--primary))' },
      { name: 'Frontend', tokens: 85, color: 'hsl(var(--success))' },
      { name: 'Backend', tokens: 155, color: 'hsl(var(--info))' },
      { name: 'QA', tokens: 78, color: 'hsl(var(--warning))' },
      { name: 'Security', tokens: 52, color: 'hsl(var(--destructive))' },
    ],
  },
  {
    id: 'ses-003',
    date: 'Apr 12, 2026',
    startTime: '10:00 AM',
    duration: '45m',
    status: 'completed' as const,
    agentsUsed: 3,
    tokensUsed: 120000,
    cost: 45,
    budget: 150,
    filesModified: 14,
    linesWritten: 1890,
    tasksCompleted: 4,
    tasksTotal: 4,
    healthScore: 92,
    highlights: ['Sprint 2 completed', 'All tests passing', 'Docs updated'],
    costTimeline: [
      { t: '0m', cost: 0 }, { t: '10m', cost: 12 }, { t: '20m', cost: 25 },
      { t: '30m', cost: 35 }, { t: '45m', cost: 45 },
    ],
    agentBreakdown: [
      { name: 'Planning', tokens: 45, color: 'hsl(var(--primary))' },
      { name: 'QA', tokens: 42, color: 'hsl(var(--warning))' },
      { name: 'Docs', tokens: 33, color: 'hsl(var(--muted-foreground))' },
    ],
  },
  {
    id: 'ses-002',
    date: 'Apr 11, 2026',
    startTime: '11:30 AM',
    duration: '3h 05m',
    status: 'completed' as const,
    agentsUsed: 6,
    tokensUsed: 680000,
    cost: 198,
    budget: 200,
    filesModified: 64,
    linesWritten: 9200,
    tasksCompleted: 10,
    tasksTotal: 12,
    healthScore: 74,
    highlights: ['Major refactor of auth module', 'Budget nearly exhausted', '2 agents throttled'],
    costTimeline: [
      { t: '0m', cost: 0 }, { t: '30m', cost: 42 }, { t: '60m', cost: 95 },
      { t: '90m', cost: 138 }, { t: '120m', cost: 172 }, { t: '150m', cost: 190 }, { t: '185m', cost: 198 },
    ],
    agentBreakdown: [
      { name: 'Planning', tokens: 95, color: 'hsl(var(--primary))' },
      { name: 'Frontend', tokens: 120, color: 'hsl(var(--success))' },
      { name: 'Backend', tokens: 185, color: 'hsl(var(--info))' },
      { name: 'QA', tokens: 110, color: 'hsl(var(--warning))' },
      { name: 'Security', tokens: 88, color: 'hsl(var(--destructive))' },
      { name: 'Docs', tokens: 82, color: 'hsl(var(--muted-foreground))' },
    ],
  },
];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <div className="font-mono text-muted-foreground mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
          <span className="text-muted-foreground">{p.dataKey}:</span>
          <span className="font-mono font-semibold">${p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SessionHistory() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Session History</h1>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span>{pastSessions.length} sessions</span>
          <span>Total cost: ${pastSessions.reduce((s, ses) => s + ses.cost, 0)}</span>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Sessions', value: String(pastSessions.length), icon: Clock },
          { label: 'Total Cost', value: `$${pastSessions.reduce((s, ses) => s + ses.cost, 0)}`, icon: DollarSign },
          { label: 'Avg Health', value: `${Math.round(pastSessions.reduce((s, ses) => s + ses.healthScore, 0) / pastSessions.length)}%`, icon: BarChart3 },
          { label: 'Tasks Done', value: `${pastSessions.reduce((s, ses) => s + ses.tasksCompleted, 0)}`, icon: CheckCircle2 },
        ].map(tile => (
          <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-micro text-muted-foreground">{tile.label}</span>
              <tile.icon className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-lg font-semibold font-mono">{tile.value}</span>
          </div>
        ))}
      </div>

      {/* Session list */}
      <div className="space-y-3">
        {pastSessions.map(ses => (
          <div key={ses.id} className={cn('rounded-lg border bg-card overflow-hidden transition-colors', ses.status === 'active' ? 'border-primary/30' : 'border-border')}>
            <button onClick={() => setExpandedId(expandedId === ses.id ? null : ses.id)}
              className="flex items-center gap-4 w-full p-4 text-left hover:bg-surface-2/50 transition-colors">
              <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', ses.status === 'active' ? 'bg-primary animate-status-pulse' : 'bg-success')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{ses.date}</span>
                  <span className="text-micro text-muted-foreground">{ses.startTime}</span>
                  {ses.status === 'active' && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Live</span>}
                </div>
                <div className="flex items-center gap-4 text-micro text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{ses.duration}</span>
                  <span className="flex items-center gap-1"><Bot className="h-3 w-3" />{ses.agentsUsed} agents</span>
                  <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />${ses.cost}/${ses.budget}</span>
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{ses.filesModified} files</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className={cn('text-sm font-mono font-semibold', ses.healthScore >= 80 ? 'text-success' : ses.healthScore >= 60 ? 'text-warning' : 'text-destructive')}>{ses.healthScore}%</div>
                  <div className="text-micro text-muted-foreground">health</div>
                </div>
                <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expandedId === ses.id && 'rotate-90')} />
              </div>
            </button>

            <AnimatePresence>
              {expandedId === ses.id && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="border-t border-border p-4 space-y-4">
                    {/* Stats row */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="rounded-md bg-surface-2 p-2.5">
                        <span className="text-micro text-muted-foreground">Tokens Used</span>
                        <span className="block text-sm font-mono font-semibold">{(ses.tokensUsed / 1000).toFixed(0)}K</span>
                      </div>
                      <div className="rounded-md bg-surface-2 p-2.5">
                        <span className="text-micro text-muted-foreground">Lines Written</span>
                        <span className="block text-sm font-mono font-semibold">{ses.linesWritten.toLocaleString()}</span>
                      </div>
                      <div className="rounded-md bg-surface-2 p-2.5">
                        <span className="text-micro text-muted-foreground">Tasks</span>
                        <span className="block text-sm font-mono font-semibold">{ses.tasksCompleted}/{ses.tasksTotal}</span>
                      </div>
                      <div className="rounded-md bg-surface-2 p-2.5">
                        <span className="text-micro text-muted-foreground">Budget Used</span>
                        <Progress value={(ses.cost / ses.budget) * 100} className="h-1.5 mt-1.5" />
                      </div>
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border border-border bg-card p-3">
                        <h4 className="text-xs font-semibold mb-2">Cost Over Time</h4>
                        <ResponsiveContainer width="100%" height={120}>
                          <AreaChart data={ses.costTimeline}>
                            <defs>
                              <linearGradient id={`grad-${ses.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="t" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={25} />
                            <Tooltip content={<ChartTooltip />} />
                            <Area type="monotone" dataKey="cost" stroke="hsl(var(--primary))" fill={`url(#grad-${ses.id})`} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="rounded-lg border border-border bg-card p-3">
                        <h4 className="text-xs font-semibold mb-2">Agent Token Usage (K)</h4>
                        <ResponsiveContainer width="100%" height={120}>
                          <BarChart data={ses.agentBreakdown} layout="vertical">
                            <XAxis type="number" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={55} />
                            <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
                              {ses.agentBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Highlights */}
                    <div>
                      <h4 className="text-xs font-semibold mb-2">Highlights</h4>
                      <div className="space-y-1">
                        {ses.highlights.map(h => (
                          <div key={h} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                            {h}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
