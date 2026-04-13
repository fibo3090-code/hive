import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useHive } from '@/context/HiveContext';
import { DollarSign, Bot, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CostForecastModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CostForecastModal({ open, onOpenChange }: CostForecastModalProps) {
  const { state } = useHive();

  const agentCosts = state.agents.filter(a => a.status !== 'deprecated').map(a => ({
    name: a.name,
    model: a.model,
    estimatedCost: a.model === 'GPT-4o' ? 12.5 : a.model === 'Claude 3.5' ? 8.2 : 4.1,
    estimatedTokens: a.model === 'GPT-4o' ? 35 : a.model === 'Claude 3.5' ? 28 : 18,
  }));

  const totalEstimated = agentCosts.reduce((sum, a) => sum + a.estimatedCost, 0);
  const totalTokens = agentCosts.reduce((sum, a) => sum + a.estimatedTokens, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Pre-Session Cost Forecast</DialogTitle>
          <DialogDescription>Estimated costs for the upcoming session based on agent configuration</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: DollarSign, label: 'Est. Cost', value: `$${totalEstimated.toFixed(0)}`, color: 'text-warning' },
              { icon: Bot, label: 'Agents', value: String(agentCosts.length), color: 'text-primary' },
              { icon: Clock, label: 'Est. Tokens', value: `${totalTokens}K`, color: 'text-info' },
            ].map(s => (
              <div key={s.label} className="rounded-md border border-border bg-surface-2 p-2 text-center">
                <s.icon className={cn('h-4 w-4 mx-auto mb-1', s.color)} />
                <div className="text-sm font-semibold font-mono">{s.value}</div>
                <div className="text-micro text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Per-agent breakdown */}
          <div className="rounded-md border border-border bg-card">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-3 py-2">Agent</th><th className="text-left px-3 py-2">Model</th><th className="text-right px-3 py-2">Tokens</th><th className="text-right px-3 py-2">Cost</th></tr></thead>
              <tbody className="divide-y divide-border">
                {agentCosts.map(a => (
                  <tr key={a.name} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{a.model}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground text-right">{a.estimatedTokens}K</td>
                    <td className="px-3 py-2 font-mono text-right">${a.estimatedCost.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border font-semibold"><td className="px-3 py-2" colSpan={2}>Total</td><td className="px-3 py-2 font-mono text-right">{totalTokens}K</td><td className="px-3 py-2 font-mono text-right">${totalEstimated.toFixed(0)}</td></tr></tfoot>
            </table>
          </div>

          <div className="text-micro text-muted-foreground">
            * Estimates based on average token consumption per model over the last 5 sessions. Actual costs may vary.
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Close</button>
          <button onClick={() => { toast.success('Session started'); onOpenChange(false); }} className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90">Start Session</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
