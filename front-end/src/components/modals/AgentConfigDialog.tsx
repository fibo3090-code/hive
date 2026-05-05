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
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUpdateAgent, useToolCatalog } from '@/api/agents';
import type { Agent } from '@/types/domain';

interface AgentConfigDialogProps {
  readonly agent: Agent | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AgentConfigDialog({ agent, open, onOpenChange }: AgentConfigDialogProps) {
  const update = useUpdateAgent();
  const toolsQuery = useToolCatalog();

  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());

  // Reset whenever the dialog opens for a different agent so a stale
  // form state doesn't bleed across uses.
  useEffect(() => {
    if (!open || !agent) return;
    setName(agent.name);
    setRole(agent.role);
    setSystemPrompt('');
    setModel({
      providerId: agent.modelProviderId ?? '',
      modelId: agent.modelId ?? agent.model ?? '',
    });
    // The agent record on the frontend may not carry enabled_tools.
    // The runtime treats "no enabled_tools set" as "all registered
    // tools are usable", so leaving the set empty here means "no
    // change" — toggling at least one tool establishes the allowlist.
    setEnabledTools(new Set());
  }, [open, agent]);

  if (!agent) return null;

  const tools = toolsQuery.data ?? [];

  const toggleTool = (name: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const onSubmit = async () => {
    const patch: Parameters<typeof update.mutateAsync>[0]['patch'] = {};
    if (name.trim() && name.trim() !== agent.name) patch.name = name.trim();
    if (role.trim() && role.trim() !== agent.role) patch.role = role.trim();
    if (model?.providerId && model.modelId) {
      patch.modelProviderId = model.providerId;
      patch.modelId = model.modelId;
      patch.model = model.modelId;
    }
    if (systemPrompt.trim()) {
      patch.systemPrompt = systemPrompt.trim();
    }
    if (enabledTools.size > 0) {
      patch.enabledTools = Array.from(enabledTools);
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
            Changes apply on the agent's next turn. The runtime picks up
            new system prompts, models, and tool allowlists without a
            restart.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`agent-name-${agent.id}`} className="text-xs font-medium mb-1 block">
                Name
              </label>
              <input
                id={`agent-name-${agent.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor={`agent-role-${agent.id}`} className="text-xs font-medium mb-1 block">
                Role
              </label>
              <input
                id={`agent-role-${agent.id}`}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <span className="text-xs font-medium mb-1 block">Model</span>
            <ModelPicker value={model} onChange={setModel} />
          </div>

          <div>
            <label htmlFor={`agent-prompt-${agent.id}`} className="text-xs font-medium mb-1 block">
              System prompt{' '}
              <span className="text-muted-foreground font-normal">
                (optional override; leave blank to keep current)
              </span>
            </label>
            <textarea
              id={`agent-prompt-${agent.id}`}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              placeholder="You are a focused {role}. When asked to…"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-mono resize-y"
            />
          </div>

          <div>
            <span className="text-xs font-medium mb-2 block">
              Allowed tools{' '}
              <span className="text-muted-foreground font-normal">
                ({enabledTools.size === 0 ? 'inherit project default' : `${enabledTools.size} selected`})
              </span>
            </span>
            {toolsQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">Loading tool catalog…</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {tools.map((tool) => {
                  const selected = enabledTools.has(tool.name);
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => toggleTool(tool.name)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-md border p-2 text-left transition',
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-mono font-medium">
                        <span>{tool.name}</span>
                        {tool.sideEffects && (
                          <span
                            className="text-micro text-warning"
                            title="Has side effects"
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <div className="text-micro text-muted-foreground line-clamp-2 mt-1">
                        {tool.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={update.isPending}
            className="rounded-md bg-primary px-4 py-2 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {update.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
