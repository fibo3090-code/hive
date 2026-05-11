import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Heart, DollarSign, FileCheck, TestTube2, Bot } from 'lucide-react';
import type { Agent, Project } from '@/types/domain';

interface DashboardMetricsProps {
  readonly healthScore: number;
  readonly budgetUsed: number;
  readonly budgetTotal: number;
  readonly activeProject: Project | null;
  readonly agents: Agent[];
  readonly onNavigate: (path: string) => void;
}

export function DashboardMetrics({ healthScore, budgetUsed, budgetTotal, activeProject, agents, onNavigate }: DashboardMetricsProps) {
  const budgetPct = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;
  const specCompletion = activeProject?.specCompletion ?? 73;
  const testCoverage = activeProject?.testCoverage ?? 68;

  const metrics = [
    { label: 'Health Score', value: String(healthScore), icon: Heart, color: healthScore <= 0 ? 'text-muted-foreground' : 'text-success', sub: healthScore > 0 ? '+2 from last session' : 'No session yet', path: '/insights' },
    { label: 'Budget', value: `$${budgetUsed}/$${budgetTotal}`, icon: DollarSign, color: budgetPct > 80 ? 'text-warning' : 'text-foreground', sub: `${budgetPct}% consumed`, path: '/settings' },
    { label: 'Spec Completion', value: `${specCompletion}%`, icon: FileCheck, color: 'text-info', sub: `${activeProject?.name ?? 'Project'} requirements`, path: '/spec' },
    { label: 'Test Coverage', value: `${testCoverage}%`, icon: TestTube2, color: 'text-primary', sub: '87/94 passing', path: '/insights' },
    { label: 'Active Agents', value: `${agents.filter(a => a.status === 'working').length}/${agents.length}`, icon: Bot, color: 'text-primary', sub: `${agents.filter(a => a.status === 'blocked').length} blocked, ${agents.filter(a => a.status === 'paused').length} paused`, path: '/hive-graph' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {metrics.map((tile) => (
        <motion.div key={tile.label} whileHover={{ scale: 1.02 }} onClick={() => onNavigate(tile.path)}
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
  );
}
