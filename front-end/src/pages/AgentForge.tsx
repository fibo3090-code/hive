import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Bot, Check, Dna, Hexagon, Loader2, Plus, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useHiveData } from '@/api/queries/useHiveData';
import { useAgentBlueprintsData } from '@/api/queries/useServerData';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
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

const roles = ['Frontend', 'Backend', 'Testing', 'DevOps', 'Security', 'Documentation', 'Custom'] as const;
const tiers = [{ id: 'Local', label: 'Local' }, { id: 'Cloud', label: 'Cloud (Coming Soon)' }] as const;
const autonomyLevels = ['Low', 'Medium', 'High'] as const;

export default function AgentForge() {
  const queryClient = useQueryClient();
  const { activeProject } = useHiveData();
  const { data: blueprints = [] } = useAgentBlueprintsData();
  const { defaultModel } = useWorkspace();

  const [tab, setTab] = useState<'blueprints' | 'create'>('blueprints');
  const [dnaTarget, setDnaTarget] = useState<AgentBlueprint | null>(null);
  const [created, setCreated] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [role, setRole] = useState<string>(roles[0]);
  const [model, setModel] = useState<ModelSelection | null>(defaultModel);
  const [tier, setTier] = useState<string>(tiers[0].id);
  const [autonomy, setAutonomy] = useState<string>(autonomyLevels[1]);

  useEffect(() => {
    if (!model?.modelId && defaultModel?.modelId) {
      setModel(defaultModel);
    }
  }, [defaultModel, model]);

  const createAgent = useMutation({
    mutationFn: (body: { name: string; role: string; model: string; status?: string }) =>
      api(`/v1/projects/${activeProject?.id}/agents`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agents', activeProject?.id] });
    },
  });

  const createdAgentSummary = useMemo(
    () =>
      created
        ? {
            role,
            model: model?.modelId ?? 'Unknown',
            tier,
            autonomy,
          }
        : null,
    [autonomy, created, model?.modelId, role, tier]
  );

  const resetCreator = () => {
    setCreated(false);
    setAgentName('');
    setRole(roles[0]);
    setModel(defaultModel);
    setTier(tiers[0].id);
    setAutonomy(autonomyLevels[1]);
  };

  const applyBlueprint = (blueprint: AgentBlueprint) => {
    setTab('create');
    setCreated(false);
    setAgentName(blueprint.name);
    setRole(blueprint.role);
    setModel(defaultModel);
    setTier('Local');
    setAutonomy('Medium');
  };

  const handleCreate = async () => {
    if (!agentName.trim()) {
      toast.error('Agent name is required');
      return;
    }
    if (!model?.modelId) {
      toast.error('Select a model');
      return;
    }

    try {
      await createAgent.mutateAsync({
        name: agentName.trim(),
        role,
        model: model.modelId,
        status: 'idle',
      });
      toast.success(`${agentName.trim()} has been forged`);
      setCreated(true);
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
              <button onClick={() => setTab('create')} className="flex items-center gap-1 text-xs text-primary hover:underline">
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
              <p className="text-sm text-muted-foreground">Configure the role, live model target, sovereignty tier, and autonomy in one pass.</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <div>
                <label htmlFor="agent-name" className="text-xs font-medium mb-1.5 block">Agent Name</label>
                <input
                  id="agent-name"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder="Agent name (e.g. Widget Builder)"
                  className="w-full h-10 rounded-md border border-border bg-surface-2 px-3 text-sm"
                />
              </div>

              <div>
                <span className="text-xs font-medium mb-1.5 block">Role</span>
                <div className="flex flex-wrap gap-2">
                  {roles.map((option) => (
                    <button
                      key={option}
                      onClick={() => setRole(option)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs transition-colors',
                        role === option ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-medium mb-1.5 block">Model</span>
                <ModelPicker value={model} onChange={setModel} />
              </div>

              <div>
                <span className="text-xs font-medium mb-1.5 block">Sovereignty Tier</span>
                <div className="flex flex-wrap gap-2">
                  {tiers.map((option) => (
                    <button
                      key={option.id}
                      disabled={option.id === 'Cloud'}
                      onClick={() => setTier(option.id)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs transition-colors',
                        tier === option.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                        option.id === 'Cloud' ? 'opacity-50 cursor-not-allowed' : 'hover:text-foreground'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-medium mb-1.5 block">Autonomy</span>
                <div className="flex flex-wrap gap-2">
                  {autonomyLevels.map((option) => (
                    <button
                      key={option}
                      onClick={() => setAutonomy(option)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-xs transition-colors',
                        autonomy === option ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                Provider: <span className="font-mono text-foreground">{model?.providerId ?? 'unselected'}</span>
                {' · '}
                Model: <span className="font-mono text-foreground">{model?.modelId ?? 'unselected'}</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleCreate()}
                  disabled={!agentName.trim() || !model?.modelId || createAgent.isPending || !activeProject}
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

            {created && createdAgentSummary && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border border-success/40 bg-success/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-5 w-5 text-success" />
                  <span className="text-sm font-semibold text-success">{agentName} has been forged</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Role: {createdAgentSummary.role} · Model: {createdAgentSummary.model} · Tier: {createdAgentSummary.tier} · Autonomy: {createdAgentSummary.autonomy}
                </p>
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
