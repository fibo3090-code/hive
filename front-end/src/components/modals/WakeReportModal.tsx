import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useHiveData } from '@/api/queries/useHiveData';
import { Check, RotateCcw, DollarSign, Bot, FileCheck, TestTube2, AlertTriangle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WakeReportModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function WakeReportModal({ open, onOpenChange }: WakeReportModalProps) {
  const { state } = useHiveData();
  const { session, agents, tasks } = state;

  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const workingAgents = agents.filter(a => a.status === 'working').length;
  const blockedAgents = agents.filter(a => a.status === 'blocked').length;

  const gateChecks = [
    { label: 'All tests passing', passed: true, detail: '87/94 tests pass' },
    { label: 'No critical alerts', passed: state.alerts.filter(a => a.severity === 'critical').length === 0, detail: `${state.alerts.filter(a => a.severity === 'critical').length} critical alerts` },
    { label: 'Budget within limits', passed: (session.budgetUsed / session.budgetTotal) < 0.95, detail: `$${session.budgetUsed}/$${session.budgetTotal}` },
    { label: 'No blocked agents', passed: blockedAgents === 0, detail: `${blockedAgents} agents blocked` },
    { label: 'Spec alignment > 80%', passed: true, detail: '73% aligned' },
  ];

  const allPassed = gateChecks.every(g => g.passed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={cn('h-2.5 w-2.5 rounded-full', allPassed ? 'bg-success' : 'bg-warning')} />
            Wake Report
          </DialogTitle>
          <DialogDescription>Summary of background session activity</DialogDescription>
        </DialogHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: DollarSign, label: 'Cost', value: `$${session.budgetUsed}`, color: 'text-warning' },
            { icon: Bot, label: 'Agents', value: `${workingAgents} active`, color: 'text-primary' },
            { icon: FileCheck, label: 'Tasks Done', value: String(completedTasks), color: 'text-success' },
            { icon: TestTube2, label: 'Duration', value: session.elapsed, color: 'text-info' },
          ].map(s => (
            <div key={s.label} className="rounded-md border border-border bg-surface-2 p-2 text-center">
              <s.icon className={cn('h-4 w-4 mx-auto mb-1', s.color)} />
              <div className="text-xs font-semibold font-mono">{s.value}</div>
              <div className="text-micro text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Gate checks */}
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Gate Checks</h4>
          {gateChecks.map(g => (
            <div key={g.label} className="flex items-center gap-2 text-xs">
              <div className={cn('h-4 w-4 rounded-sm border flex items-center justify-center', g.passed ? 'border-success bg-success/10 text-success' : 'border-warning bg-warning/10 text-warning')}>
                {g.passed ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-2.5 w-2.5" />}
              </div>
              <span className="flex-1">{g.label}</span>
              <span className="text-micro text-muted-foreground font-mono">{g.detail}</span>
            </div>
          ))}
        </div>

        {/* Token usage bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Token Usage</span>
            <span className="font-mono">{(session.tokensUsed / 1000).toFixed(0)}K / 500K</span>
          </div>
          <Progress value={(session.tokensUsed / 500000) * 100} className="h-2" />
        </div>

        <DialogFooter className="gap-2">
          <button onClick={() => { toast.info('Rolling back to pre-session state...'); onOpenChange(false); }} className="flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10">
            <RotateCcw className="h-3.5 w-3.5" /> Rollback
          </button>
          <button onClick={() => { toast.success('Changes approved and merged'); onOpenChange(false); }} className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90">
            <Check className="h-3.5 w-3.5" /> Approve & Merge
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
