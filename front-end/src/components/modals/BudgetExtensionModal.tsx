import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useHiveData } from '@/api/queries/useHiveData';
import { DollarSign } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BudgetExtensionModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function BudgetExtensionModal({ open, onOpenChange }: BudgetExtensionModalProps) {
  const { state, extendBudget, dismissAlert } = useHiveData();
  const { session } = state;
  const [newTotal, setNewTotal] = useState(session.budgetTotal + 100);

  const currentPct = Math.round((session.budgetUsed / session.budgetTotal) * 100);
  const newPct = Math.round((session.budgetUsed / newTotal) * 100);
  const increase = newTotal - session.budgetTotal;

  const handleExtend = () => {
    extendBudget(newTotal);
    // Dismiss any budget-related alerts
    state.alerts.filter(a => a.title.toLowerCase().includes('budget')).forEach(a => dismissAlert(a.id));
    toast.success(`Budget extended to $${newTotal}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-warning" />
            Extend Budget
          </DialogTitle>
          <DialogDescription>Increase the session budget cap to continue agent work</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current state */}
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground">Current Budget</span>
              <span className={cn('font-mono font-semibold', currentPct > 80 ? 'text-warning' : 'text-foreground')}>${session.budgetUsed} / ${session.budgetTotal}</span>
            </div>
            <Progress value={currentPct} className="h-2" />
            <div className="text-micro text-muted-foreground mt-1">{currentPct}% consumed</div>
          </div>

          {/* Slider */}
          <div>
            <label htmlFor="budget-slider" className="text-xs font-medium mb-2 block">New Budget Limit</label>
            <Slider id="budget-slider" value={[newTotal]} onValueChange={([v]) => setNewTotal(v)} min={session.budgetTotal} max={session.budgetTotal + 500} step={25} className="mb-2" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">+${increase} increase</span>
              <span className="font-mono text-primary font-semibold">${newTotal}</span>
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-md border border-success/30 bg-success/5 p-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground">After Extension</span>
              <span className="font-mono text-success">${session.budgetUsed} / ${newTotal}</span>
            </div>
            <Progress value={newPct} className="h-2" />
            <div className="text-micro text-success mt-1">{newPct}% consumed — {100 - newPct}% remaining</div>
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleExtend} className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90">Extend Budget</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
