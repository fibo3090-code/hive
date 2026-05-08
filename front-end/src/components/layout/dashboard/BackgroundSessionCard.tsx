import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useHiveData } from '@/api/queries/useHiveData';

interface BackgroundSessionCardProps {
  readonly onViewWakeReport: () => void;
}

export function BackgroundSessionCard({ onViewWakeReport }: BackgroundSessionCardProps) {
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
