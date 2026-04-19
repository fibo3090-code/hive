import { useState } from 'react';
import { cn } from '@/lib/utils';
import { BarChart3, Bot, CheckCircle2, ChevronRight, Clock, DollarSign, FileText } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSessionHistoryData } from '@/api/queries/useServerData';
import type { AgentBreakdownItem, SessionHistoryItem } from '@/types/domain';

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
          <span className="text-muted-foreground">{entry.dataKey}:</span>
          <span className="font-mono font-semibold">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
      <h3 className="text-sm font-semibold mb-1">No session history yet</h3>
      <p className="text-xs text-muted-foreground">Past and current sessions will appear here once the backend records them.</p>
    </div>
  );
}

export default function SessionHistory() {
  const { activeProject } = useHiveData();
  const historyQuery = useSessionHistoryData(activeProject?.id);
  const sessions: SessionHistoryItem[] = historyQuery.data ?? [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalCost = sessions.reduce((sum, session: SessionHistoryItem) => sum + (session.cost ?? 0), 0);
  const averageHealth =
    sessions.length > 0
      ? Math.round(sessions.reduce((sum, session: SessionHistoryItem) => sum + (session.healthScore ?? 0), 0) / sessions.length)
      : 0;
  const totalTasks = sessions.reduce((sum, session: SessionHistoryItem) => sum + (session.tasksCompleted ?? 0), 0);

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Session History</h1>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span>{sessions.length} sessions</span>
          <span>Total cost: ${totalCost}</span>
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Sessions', value: String(sessions.length), icon: Clock },
              { label: 'Total Cost', value: `$${totalCost}`, icon: DollarSign },
              { label: 'Avg Health', value: `${averageHealth}%`, icon: BarChart3 },
              { label: 'Tasks Done', value: `${totalTasks}`, icon: CheckCircle2 },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-micro text-muted-foreground">{tile.label}</span>
                  <tile.icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-lg font-semibold font-mono">{tile.value}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {sessions.map((session: SessionHistoryItem) => (
              <div
                key={session.id}
                className={cn(
                  'rounded-lg border bg-card overflow-hidden transition-colors',
                  session.status === 'active' ? 'border-primary/30' : 'border-border'
                )}
              >
                <button
                  onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                  className="flex items-center gap-4 w-full p-4 text-left hover:bg-surface-2/50 transition-colors"
                >
                  <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', session.status === 'active' ? 'bg-primary animate-status-pulse' : 'bg-success')} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{session.date}</span>
                      <span className="text-micro text-muted-foreground">{session.startTime}</span>
                      {session.status === 'active' && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Live</span>}
                    </div>
                    <div className="flex items-center gap-4 text-micro text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{session.duration}</span>
                      <span className="flex items-center gap-1"><Bot className="h-3 w-3" />{session.agentsUsed} agents</span>
                      <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />${session.cost}/${session.budget}</span>
                      <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{session.filesModified} files</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div
                        className={cn(
                          'text-sm font-mono font-semibold',
                          session.healthScore >= 80
                            ? 'text-success'
                            : session.healthScore >= 60
                              ? 'text-warning'
                              : 'text-destructive'
                        )}
                      >
                        {session.healthScore}%
                      </div>
                      <div className="text-micro text-muted-foreground">health</div>
                    </div>
                    <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', expandedId === session.id && 'rotate-90')} />
                  </div>
                </button>

                <AnimatePresence>
                  {expandedId === session.id && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="border-t border-border p-4 space-y-4">
                        <div className="grid grid-cols-4 gap-3">
                          <div className="rounded-md bg-surface-2 p-2.5">
                            <span className="text-micro text-muted-foreground">Tokens Used</span>
                            <span className="block text-sm font-mono font-semibold">{Math.round((session.tokensUsed ?? 0) / 1000)}K</span>
                          </div>
                          <div className="rounded-md bg-surface-2 p-2.5">
                            <span className="text-micro text-muted-foreground">Lines Written</span>
                            <span className="block text-sm font-mono font-semibold">{(session.linesWritten ?? 0).toLocaleString()}</span>
                          </div>
                          <div className="rounded-md bg-surface-2 p-2.5">
                            <span className="text-micro text-muted-foreground">Tasks</span>
                            <span className="block text-sm font-mono font-semibold">{session.tasksCompleted}/{session.tasksTotal}</span>
                          </div>
                          <div className="rounded-md bg-surface-2 p-2.5">
                            <span className="text-micro text-muted-foreground">Budget Used</span>
                            <Progress value={session.budget > 0 ? (session.cost / session.budget) * 100 : 0} className="h-1.5 mt-1.5" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="rounded-lg border border-border bg-card p-3">
                            <h4 className="text-xs font-semibold mb-2">Cost Over Time</h4>
                            <ResponsiveContainer width="100%" height={120}>
                              <AreaChart data={session.costTimeline ?? []}>
                                <defs>
                                  <linearGradient id={`grad-${session.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <XAxis dataKey="t" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={25} />
                                <Tooltip content={<ChartTooltip />} />
                                <Area type="monotone" dataKey="cost" stroke="hsl(var(--primary))" fill={`url(#grad-${session.id})`} strokeWidth={2} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="rounded-lg border border-border bg-card p-3">
                            <h4 className="text-xs font-semibold mb-2">Agent Token Usage (K)</h4>
                            <ResponsiveContainer width="100%" height={120}>
                              <BarChart data={session.agentBreakdown ?? []} layout="vertical">
                                <XAxis type="number" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={55} />
                                <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
                                  {(session.agentBreakdown ?? []).map((entry: AgentBreakdownItem, index: number) => (
                                    <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-xs font-semibold mb-2">Highlights</h4>
                          <div className="space-y-1">
                            {(session.highlights ?? []).map((highlight: string) => (
                              <div key={highlight} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                                {highlight}
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
        </>
      )}
    </div>
  );
}
