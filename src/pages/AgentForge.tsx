import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Bot, Check, Cpu, Dna, Hexagon, Loader2, Plus, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useHiveData } from '@/api/queries/useHiveData';
import { useAgentBlueprintsData } from '@/api/queries/useServerData';
import { api } from '@/api/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const conversationSteps = [
  { question: 'What role should this agent fill?', options: ['Frontend', 'Backend', 'Testing', 'DevOps', 'Security', 'Documentation', 'Custom'] },
  { question: 'Which LLM should power this agent?', options: ['GPT-4o', 'Claude 3.5 Sonnet', 'Gemini Pro', 'Local (Ollama)'] },
  { question: 'What sovereignty tier?', options: ['Local', 'Hybrid', 'Cloud'] },
  { question: 'How autonomous should it be?', options: ['Low', 'Medium', 'High'] },
] as const;

function DNAViewer({
  dna,
  name,
  open,
  onOpenChange,
}: {
  dna: Record<string, number>;
  name: string;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Dna className="h-5 w-5 text-primary" /> {name} — DNA Profile
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {Object.entries(dna).map(([trait, value]) => (
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
                  className={cn(
                    'h-full rounded-full',
                    value >= 90 ? 'bg-success' : value >= 70 ? 'bg-primary' : value >= 50 ? 'bg-warning' : 'bg-muted-foreground'
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentForge() {
  const queryClient = useQueryClient();
  const { activeProject } = useHiveData();
  const { data: blueprints = [] } = useAgentBlueprintsData();
  const [tab, setTab] = useState<'blueprints' | 'create'>('blueprints');
  const [dnaTarget, setDnaTarget] = useState<any | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [created, setCreated] = useState(false);
  const [agentName, setAgentName] = useState('');

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
            role: answers[0] ?? 'Custom',
            model: answers[1] ?? 'GPT-4o',
            tier: answers[2] ?? 'Hybrid',
            autonomy: answers[3] ?? 'Medium',
          }
        : null,
    [answers, created]
  );

  const handleAnswer = (answer: string) => {
    const next = [...answers, answer];
    setAnswers(next);
    if (step < conversationSteps.length - 1) {
      setStep((current) => current + 1);
    }
  };

  const handleCreate = async () => {
    if (!agentName.trim()) return;

    try {
      await createAgent.mutateAsync({
        name: agentName.trim(),
        role: answers[0] ?? 'Custom',
        model: answers[1] ?? 'GPT-4o',
        status: 'idle',
      });
      toast.success(`${agentName.trim()} has been forged`);
      setCreated(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to forge agent');
    }
  };

  const resetCreator = () => {
    setStep(0);
    setAnswers([]);
    setCreated(false);
    setAgentName('');
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
              {blueprints.map((blueprint: any) => (
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
                      onClick={() => {
                        setTab('create');
                        setAgentName(blueprint.name);
                        setAnswers([blueprint.role, blueprint.model, 'Hybrid', 'Medium']);
                        setStep(conversationSteps.length - 1);
                      }}
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
          <div className="max-w-xl space-y-6">
            <h2 className="text-lg font-semibold">Create Agent</h2>
            <p className="text-sm text-muted-foreground">Answer a few questions to configure your new agent.</p>

            <div className="space-y-4">
              {conversationSteps.slice(0, step + 1).map((item, index) => (
                <motion.div key={item.question} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <div className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <Hexagon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-lg bg-card border border-border px-4 py-2.5">
                      <span className="text-sm">{item.question}</span>
                    </div>
                  </div>
                  {answers[index] ? (
                    <div className="flex justify-end">
                      <div className="rounded-lg bg-primary/10 px-4 py-2.5">
                        <span className="text-sm">{answers[index]}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 ml-10">
                      {item.options.map((option) => (
                        <button
                          key={option}
                          onClick={() => handleAnswer(option)}
                          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}

              {answers.length === conversationSteps.length && !created && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 ml-10">
                  <input
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="Agent name (e.g. Widget Builder)"
                    className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm"
                  />
                  <button
                    onClick={() => void handleCreate()}
                    disabled={!agentName.trim() || createAgent.isPending || !activeProject}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {createAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {createAgent.isPending ? 'Forging agent...' : 'Forge Agent'}
                  </button>
                </motion.div>
              )}

              {created && createdAgentSummary && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="rounded-lg border border-success/40 bg-success/5 p-4 ml-10">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-5 w-5 text-success" />
                    <span className="text-sm font-semibold text-success">{agentName} has been forged</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Role: {createdAgentSummary.role} · Model: {createdAgentSummary.model} · Tier: {createdAgentSummary.tier} · Autonomy: {createdAgentSummary.autonomy}
                  </p>
                  <button onClick={resetCreator} className="text-xs text-primary hover:underline mt-2">
                    Create another
                  </button>
                </motion.div>
              )}
            </div>
          </div>
        )}
      </div>

      {dnaTarget && (
        <DNAViewer dna={dnaTarget.dna} name={dnaTarget.name} open={!!dnaTarget} onOpenChange={() => setDnaTarget(null)} />
      )}
    </div>
  );
}
