import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import type { AgentItem } from '@/types/domain';

interface AgentCardsProps {
  readonly agents: AgentItem[];
  readonly onNavigate: (path: string) => void;
}

export function AgentCards({ agents, onNavigate }: AgentCardsProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Agents</h3>
        <button onClick={() => onNavigate('/hive-graph')} className="text-micro text-primary hover:underline">{agents.length} total</button>
      </div>
      <div className="p-3 space-y-2 max-h-[360px] overflow-auto scrollbar-thin">
        {agents.map((agent) => {
          const qualityScore = agent.qualityScore ?? 0;
          const agentBorderIfPaused = agent.status === 'paused' ? 'border-warning/30' : 'border-border';
          const agentBorderIfBlocked = agent.status === 'blocked' ? 'border-destructive/30' : agentBorderIfPaused;
          const agentBorderColor = agent.status === 'working' ? 'border-success/30' : agentBorderIfBlocked;
          return (
          <motion.div key={agent.id} whileHover={{ scale: 1.01 }} onClick={() => onNavigate('/hive-graph')}
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
  );
}
