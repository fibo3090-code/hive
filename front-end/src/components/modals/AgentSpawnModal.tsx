import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Bot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useHiveData } from '@/api/queries/useHiveData';

interface AgentSpawnModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const roles = ['Frontend', 'Backend', 'Testing', 'Security', 'Documentation', 'DevOps', 'Data'] as const;
// Cloud sovereignty tier requires the (not-yet-built) Hive central server; only Local is selectable today.
const tiers = ['local', 'cloud'] as const;

export function AgentSpawnModal({ open, onOpenChange }: AgentSpawnModalProps) {
  const { defaultModel } = useWorkspace();
  const { activeProject } = useHiveData();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>(roles[0]);
  const [model, setModel] = useState<ModelSelection | null>(defaultModel);
  const [tier, setTier] = useState<string>(tiers[0]);
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    if (open && !model?.modelId && defaultModel?.modelId) {
      setModel(defaultModel);
    }
  }, [defaultModel, model, open]);

  const createAgent = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/projects/${activeProject?.id}/agents`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', activeProject?.id] }),
  });

  const handleSpawn = async () => {
    if (!activeProject) { toast.error('No active project'); return; }
    if (!name.trim()) { toast.error('Agent name required'); return; }
    if (!model?.modelId) { toast.error('Select a model'); return; }
    try {
      await createAgent.mutateAsync({
        name: name.trim(),
        role,
        model: model.modelId,
        status: 'idle',
        modelProviderId: model.providerId,
        modelId: model.modelId,
        systemPrompt: systemPrompt.trim() || undefined,
      });
      toast.success(`Agent "${name.trim()}" spawned as ${role}`);
      setName('');
      setSystemPrompt('');
      setModel(defaultModel);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to spawn agent');
    }
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
            <span className="text-xs font-medium mb-1.5 block">Role</span>
            <div id="agent-role" className="flex flex-wrap gap-1.5">
              {roles.map(r => (
                <button key={r} onClick={() => setRole(r)} className={cn('rounded-md px-3 py-1.5 text-xs border transition-colors', role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{r}</button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-xs font-medium mb-1.5 block">Model</span>
            <ModelPicker value={model} onChange={setModel} />
          </div>

          <div>
            <span className="text-xs font-medium mb-1.5 block">Sovereignty Tier</span>
            <div id="agent-tier" className="flex gap-1.5">
              {tiers.map(t => {
                const disabled = t === 'cloud';
                return (
                  <button
                    key={t}
                    disabled={disabled}
                    title={disabled ? 'Requires Hive central server (not yet available)' : undefined}
                    onClick={() => !disabled && setTier(t)}
                    className={cn('rounded-md px-3 py-1.5 text-xs border capitalize transition-colors', tier === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground', disabled && 'opacity-40 cursor-not-allowed')}
                  >
                    {t}{disabled && ' (server-only)'}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="agent-system-prompt" className="text-xs font-medium mb-1.5 block">System Prompt <span className="text-muted-foreground font-normal">(optional)</span></label>
            <textarea id="agent-system-prompt" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Extra instructions applied at the start of every turn…" className="w-full h-20 rounded-md border border-border bg-surface-2 p-3 text-xs resize-none scrollbar-thin" />
          </div>
        </div>

        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={handleSpawn} disabled={createAgent.isPending} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {createAgent.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Spawn Agent
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
