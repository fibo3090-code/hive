import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Bot, Check, Dna, Hexagon, Loader2, Plus, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useHiveData } from '@/api/queries/useHiveData';
import { useAgentBlueprintsData } from '@/api/queries/useServerData';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentFormFields, type AgentFormValue, EMPTY_AGENT_FORM } from '@/components/shared/AgentFormFields';
import { useWorkspace } from '@/context/WorkspaceContext';
import { toast } from 'sonner';
import type { AgentBlueprint } from '@/types/domain';

function DNAViewer({
  dna,
  name,
  open,
  onOpenChange,
}: {
  readonly dna: Record<string, number>;
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (value: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dna className="h-5 w-5 text-primary" /> {name} - DNA Profile
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {Object.entries(dna).map(([trait, value]) => {
            const traitColorIfLow = value >= 50 ? 'bg-warning' : 'bg-muted-foreground';
            const traitColorIfMid = value >= 70 ? 'bg-primary' : traitColorIfLow;
            const traitBarColor = value >= 90 ? 'bg-success' : traitColorIfMid;
            return (
              <div key={trait}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs capitalize">{trait}</span>
                  <span className="text-micro font-mono text-primary">{value}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${value}%` }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className={cn('h-full rounded-full', traitBarColor)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentForge() {
  const queryClient = useQueryClient();
  const { activeProject } = useHiveData();
  const { data: blueprints = [] } = useAgentBlueprintsData();
  const { defaultModel } = useWorkspace();

  const [tab, setTab] = useState<'blueprints' | 'create'>('blueprints');
  const [dnaTarget, setDnaTarget] = useState<AgentBlueprint | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormValue>({ ...EMPTY_AGENT_FORM, model: defaultModel });

  useEffect(() => {
    if (!form.model?.modelId && defaultModel?.modelId) setForm((f) => ({ ...f, model: defaultModel }));
  }, [defaultModel, form.model?.modelId]);

  const createAgent = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: string }>(`/v1/projects/${activeProject?.id}/agents`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', activeProject?.id] });
    },
  });

  const resetCreator = () => {
    setCreated(null);
    setForm({ ...EMPTY_AGENT_FORM, model: defaultModel });
  };

  const applyBlueprint = (blueprint: AgentBlueprint) => {
    setTab('create');
    setCreated(null);
    setForm({ ...EMPTY_AGENT_FORM, name: blueprint.name, role: blueprint.role, model: defaultModel });
  };

  const handleCreate = async () => {
    if (!activeProject) { toast.error('No active project'); return; }
    if (!form.name.trim()) { toast.error('Agent name is required'); return; }
    if (!form.model?.modelId) { toast.error('Select a model'); return; }
    try {
      const created = await createAgent.mutateAsync({
        name: form.name.trim(),
        role: form.role.trim() || 'Generalist',
        model: form.model.modelId,
        status: 'idle',
        modelProviderId: form.model.providerId,
        modelId: form.model.modelId,
        systemPrompt: form.systemPrompt.trim() || undefined,
        enabledTools: form.enabledTools.length ? form.enabledTools : undefined,
      });
      if (created?.id && form.skillIds.length > 0) {
        const results = await Promise.allSettled(
          form.skillIds.map((skillId) =>
            api(`/v1/agents/${created.id}/skills`, {
              method: 'POST',
              body: JSON.stringify({ skillId }),
            }),
          ),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) toast.warning(`${failed} skill binding(s) failed.`);
      }
      setCreated(form.name.trim());
      toast.success(`${form.name.trim()} has been forged`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to forge agent');
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {[
          { id: 'blueprints' as const, label: 'Blueprints', icon: Hexagon },
          { id: 'create' as const, label: 'Create Agent', icon: Sparkles },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setTab(item.id);
              if (item.id === 'create') resetCreator();
            }}
            className={cn(
              'flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              tab === item.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {tab === 'blueprints' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Agent Blueprints</h2>
              <button onClick={() => { setTab('create'); resetCreator(); }} className="flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="h-3.5 w-3.5" /> Create Custom
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {blueprints.map((blueprint) => (
                <div key={blueprint.id} className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{blueprint.icon}</span>
                      <div>
                        <h3 className="text-sm font-semibold">{blueprint.name}</h3>
                        <span className="text-micro font-mono text-muted-foreground">{blueprint.model}</span>
                      </div>
                    </div>
                    <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{blueprint.role}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{blueprint.description}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {(blueprint.traits ?? []).map((trait: string) => (
                      <span key={trait} className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {trait}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDnaTarget(blueprint)} className="flex items-center gap-1 text-micro text-muted-foreground hover:text-primary">
                      <Dna className="h-3 w-3" /> DNA
                    </button>
                    <button
                      onClick={() => applyBlueprint(blueprint)}
                      className="flex items-center gap-1 text-micro text-muted-foreground hover:text-primary ml-auto"
                    >
                      <Bot className="h-3 w-3" /> Use Blueprint
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Create Agent</h2>
              <p className="text-sm text-muted-foreground">Same form the HiveGraph spawn modal and the agent-config dialog use — name, role, live model target, system prompt, and tool allowlist.</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <AgentFormFields value={form} onChange={setForm} idPrefix="forge" projectId={activeProject?.id} />

              <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                Provider: <span className="font-mono text-foreground">{form.model?.providerId || 'unselected'}</span>
                {' · '}
                Model: <span className="font-mono text-foreground">{form.model?.modelId || 'unselected'}</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleCreate()}
                  disabled={!form.name.trim() || !form.model?.modelId || createAgent.isPending || !activeProject}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {createAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {createAgent.isPending ? 'Forging agent...' : 'Forge Agent'}
                </button>
                <button onClick={resetCreator} className="text-xs text-muted-foreground hover:text-foreground">
                  Reset
                </button>
              </div>
            </div>

            {created && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border border-success/40 bg-success/5 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Check className="h-5 w-5 text-success" />
                  <span className="text-sm font-semibold text-success">{created} has been forged</span>
                </div>
                <p className="text-xs text-muted-foreground">It now appears in HiveGraph and the Chat Central sidebar. Forge another, or reset the form.</p>
              </motion.div>
            )}
          </div>
        )}
      </div>

      {dnaTarget && (
        <DNAViewer dna={dnaTarget.dna} name={dnaTarget.name} open={!!dnaTarget} onOpenChange={() => setDnaTarget(null)} />
      )}
    </div>
  );
}
