import { useEffect, useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useUpdateAgent } from '@/api/agents';
import { AgentFormFields, type AgentFormValue, EMPTY_AGENT_FORM } from '@/components/shared/AgentFormFields';
import type { Agent } from '@/types/domain';

interface AgentConfigDialogProps {
  readonly agent: Agent | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function formFor(agent: Agent): AgentFormValue {
  return {
    name: agent.name,
    role: agent.role,
    model: { providerId: agent.modelProviderId ?? '', modelId: agent.modelId ?? agent.model ?? '' },
    systemPrompt: agent.systemPrompt ?? '',
    enabledTools: agent.enabledTools ?? [],
  };
}

export function AgentConfigDialog({ agent, open, onOpenChange }: AgentConfigDialogProps) {
  const update = useUpdateAgent();
  const [form, setForm] = useState<AgentFormValue>(EMPTY_AGENT_FORM);

  useEffect(() => {
    if (open && agent) setForm(formFor(agent));
  }, [open, agent]);

  if (!agent) return null;

  const onSubmit = async () => {
    const original = formFor(agent);
    const patch: Parameters<typeof update.mutateAsync>[0]['patch'] = {};
    if (form.name.trim() && form.name.trim() !== original.name) patch.name = form.name.trim();
    if (form.role.trim() && form.role.trim() !== original.role) patch.role = form.role.trim();
    if (form.model?.modelId && (form.model.modelId !== original.model?.modelId || form.model.providerId !== original.model?.providerId)) {
      patch.modelProviderId = form.model.providerId || null;
      patch.modelId = form.model.modelId;
      patch.model = form.model.modelId;
    }
    if (form.systemPrompt.trim() !== (original.systemPrompt ?? '').trim()) {
      patch.systemPrompt = form.systemPrompt.trim() || null;
    }
    const a = [...form.enabledTools].sort();
    const b = [...original.enabledTools].sort();
    if (a.length !== b.length || a.some((t, i) => t !== b[i])) {
      patch.enabledTools = form.enabledTools;
    }

    if (Object.keys(patch).length === 0) {
      toast.info('No changes to save');
      return;
    }
    try {
      await update.mutateAsync({ agentId: agent.id, patch });
      toast.success(`${agent.name} updated`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update agent');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" /> Configure {agent.name}
          </DialogTitle>
          <DialogDescription>
            Changes apply on the agent's next turn — the runtime picks up new system prompts, models, and tool allowlists without a restart.
          </DialogDescription>
        </DialogHeader>

        <AgentFormFields value={form} onChange={setForm} idPrefix={`cfg-${agent.id}`} systemPromptHint="leave blank to clear the override" />

        <DialogFooter className="gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <button type="button" onClick={() => void onSubmit()} disabled={update.isPending} className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2">
            {update.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
