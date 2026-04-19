import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';

interface AgentSpawnModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const roles = ['Frontend', 'Backend', 'Testing', 'Security', 'Documentation', 'DevOps', 'Data'] as const;
const tiers = ['local', 'hybrid', 'cloud'] as const;

export function AgentSpawnModal({ open, onOpenChange }: AgentSpawnModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(roles[0]);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [tier, setTier] = useState<string>(tiers[1]);

  const handleSpawn = () => {
    if (!name.trim()) { toast.error('Agent name required'); return; }
    if (!model?.modelId) { toast.error('Select a model'); return; }
    toast.success(`Agent "${name}" spawned as ${role} on ${model.modelId}`);
    setName('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" /> Spawn Agent</DialogTitle>
          <DialogDescription>Configure and deploy a new agent to the hive</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="agent-name" className="text-xs font-medium mb-1.5 block">Agent Name</label>
            <input id="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. API Architect" className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
          </div>

          <div>
            <label htmlFor="agent-role" className="text-xs font-medium mb-1.5 block">Role</label>
            <div id="agent-role" className="flex flex-wrap gap-1.5">
              {roles.map(r => (
                <button key={r} onClick={() => setRole(r)} className={cn('rounded-md px-3 py-1.5 text-xs border transition-colors', role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{r}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1.5 block">Model</label>
            <ModelPicker value={model} onChange={setModel} />
          </div>

          <div>
            <label htmlFor="agent-tier" className="text-xs font-medium mb-1.5 block">Sovereignty Tier</label>
            <div id="agent-tier" className="flex gap-1.5">
              {tiers.map(t => (
                <button key={t} onClick={() => setTier(t)} className={cn('rounded-md px-3 py-1.5 text-xs border capitalize transition-colors', tier === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{t}</button>
              ))}
            </div>
          </div>

          {/* Cost estimate */}
          <div className="rounded-md border border-border bg-surface-2 p-3 text-xs">
            <div className="flex justify-between text-muted-foreground mb-1"><span>Estimated cost/hr</span><span className="font-mono">~$8.50</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Estimated tokens/hr</span><span className="font-mono">~25K</span></div>
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSpawn} className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90">Spawn Agent</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
