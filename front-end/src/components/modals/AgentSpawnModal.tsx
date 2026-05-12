import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { AgentFormFields, type AgentFormValue, EMPTY_AGENT_FORM } from '@/components/shared/AgentFormFields';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useHiveData } from '@/api/queries/useHiveData';

interface AgentSpawnModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AgentSpawnModal({ open, onOpenChange }: AgentSpawnModalProps) {
  const { defaultModel } = useWorkspace();
  const { activeProject } = useHiveData();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgentFormValue>({ ...EMPTY_AGENT_FORM, model: defaultModel });

  useEffect(() => {
    if (open) setForm({ ...EMPTY_AGENT_FORM, model: defaultModel });
  }, [open, defaultModel]);

  const createAgent = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/projects/${activeProject?.id}/agents`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', activeProject?.id] }),
  });

  const handleSpawn = async () => {
    if (!activeProject) { toast.error('No active project'); return; }
    if (!form.name.trim()) { toast.error('Agent name required'); return; }
    if (!form.model?.modelId) { toast.error('Select a model'); return; }
    try {
      await createAgent.mutateAsync({
        name: form.name.trim(),
        role: form.role.trim() || 'Generalist',
        model: form.model.modelId,
        status: 'idle',
        modelProviderId: form.model.providerId,
        modelId: form.model.modelId,
        systemPrompt: form.systemPrompt.trim() || undefined,
        enabledTools: form.enabledTools.length ? form.enabledTools : undefined,
      });
      toast.success(`Agent "${form.name.trim()}" spawned`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to spawn agent');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" /> Spawn Agent</DialogTitle>
          <DialogDescription>Configure and deploy a new agent to the hive</DialogDescription>
        </DialogHeader>

        <AgentFormFields value={form} onChange={setForm} idPrefix="spawn" />

        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={() => { void handleSpawn(); }} disabled={createAgent.isPending} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {createAgent.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Spawn Agent
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
