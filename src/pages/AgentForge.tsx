import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Cpu, Hexagon, Plus, Dna, MessageSquare, Sparkles, Check, Loader2, Eye, Copy, ChevronRight, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useHive } from '@/context/HiveContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/* ─── Blueprint Templates ─── */
const blueprints = [
  { id: 'bp-frontend', name: 'Frontend Developer', role: 'Frontend', model: 'Claude 3.5', description: 'Builds UI components, handles styling, and implements responsive layouts.', traits: ['React', 'Tailwind', 'Accessibility', 'Animations'], icon: '🎨', dna: { creativity: 85, precision: 78, speed: 90, autonomy: 72, collaboration: 88 } },
  { id: 'bp-backend', name: 'Backend Engineer', role: 'Backend', model: 'GPT-4o', description: 'Designs APIs, manages database schemas, and implements server-side logic.', traits: ['REST', 'GraphQL', 'PostgreSQL', 'Security'], icon: '⚙️', dna: { creativity: 65, precision: 95, speed: 80, autonomy: 85, collaboration: 70 } },
  { id: 'bp-qa', name: 'QA Sentinel', role: 'Testing', model: 'Claude 3.5', description: 'Writes unit/integration tests, runs coverage analysis, and validates behavior.', traits: ['Vitest', 'Playwright', 'Coverage', 'Edge Cases'], icon: '🛡️', dna: { creativity: 50, precision: 98, speed: 75, autonomy: 60, collaboration: 80 } },
  { id: 'bp-devops', name: 'DevOps Engineer', role: 'Infrastructure', model: 'GPT-4o', description: 'Manages CI/CD pipelines, containerization, and deployment automation.', traits: ['Docker', 'GitHub Actions', 'Terraform', 'Monitoring'], icon: '🚀', dna: { creativity: 55, precision: 92, speed: 85, autonomy: 90, collaboration: 65 } },
  { id: 'bp-security', name: 'Security Auditor', role: 'Security', model: 'GPT-4o', description: 'Performs vulnerability scanning, code audits, and compliance checks.', traits: ['OWASP', 'Pen Testing', 'Encryption', 'Compliance'], icon: '🔒', dna: { creativity: 40, precision: 99, speed: 60, autonomy: 95, collaboration: 55 } },
  { id: 'bp-docs', name: 'Documentation Writer', role: 'Documentation', model: 'Gemini Pro', description: 'Generates API docs, guides, changelogs, and architecture diagrams.', traits: ['Markdown', 'OpenAPI', 'Diagrams', 'Tutorials'], icon: '📝', dna: { creativity: 90, precision: 85, speed: 95, autonomy: 50, collaboration: 75 } },
];

/* ─── Conversation-based Agent Creator ─── */
const conversationSteps = [
  { question: "What role should this agent fill?", options: ['Frontend', 'Backend', 'Testing', 'DevOps', 'Security', 'Documentation', 'Custom'] },
  { question: "Which LLM should power this agent?", options: ['GPT-4o', 'Claude 3.5 Sonnet', 'Gemini Pro', 'Local (Ollama)'] },
  { question: "What sovereignty tier?", options: ['Local — all data on-premises', 'Hybrid — mixed processing', 'Cloud — full cloud processing'] },
  { question: "How autonomous should it be?", options: ['Low — require approval for all actions', 'Medium — auto-execute safe actions', 'High — full autonomy with post-hoc review'] },
];

function DNAViewer({ dna, name, open, onOpenChange }: { dna: Record<string, number>; name: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Dna className="h-5 w-5 text-primary" /> {name} — DNA Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {Object.entries(dna).map(([trait, value]) => (
            <div key={trait}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs capitalize">{trait}</span>
                <span className="text-micro font-mono text-primary">{value}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6, delay: 0.1 }}
                  className={cn('h-full rounded-full', value >= 90 ? 'bg-success' : value >= 70 ? 'bg-primary' : value >= 50 ? 'bg-warning' : 'bg-muted-foreground')} />
              </div>
            </div>
          ))}
          <div className="rounded-md border border-border bg-surface-2 p-3 mt-4">
            <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Genome Sequence</h4>
            <pre className="text-micro font-mono text-muted-foreground break-all leading-relaxed">
              {Object.entries(dna).map(([k, v]) => `${k.slice(0, 3).toUpperCase()}:${v.toString(16).padStart(2, '0')}`).join('-')}
              -SIG:{Math.random().toString(36).slice(2, 10).toUpperCase()}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentForge() {
  const [tab, setTab] = useState<'blueprints' | 'create'>('blueprints');
  const [dnaTarget, setDnaTarget] = useState<typeof blueprints[0] | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [agentName, setAgentName] = useState('');

  const handleAnswer = (answer: string) => {
    const next = [...answers, answer];
    setAnswers(next);
    if (step < conversationSteps.length - 1) {
      setStep(step + 1);
    }
  };

  const handleCreate = () => {
    setCreating(true);
    setTimeout(() => {
      setCreating(false);
      setCreated(true);
    }, 2000);
  };

  const resetCreator = () => {
    setStep(0);
    setAnswers([]);
    setCreating(false);
    setCreated(false);
    setAgentName('');
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {[
          { id: 'blueprints' as const, label: 'Blueprints', icon: Hexagon },
          { id: 'create' as const, label: 'Create Agent', icon: Sparkles },
        ].map(item => (
          <button key={item.id} onClick={() => { setTab(item.id); if (item.id === 'create') resetCreator(); }}
            className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors', tab === item.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
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
              <button onClick={() => setTab('create')} className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Create Custom</button>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {blueprints.map(bp => (
                <div key={bp.id} className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 transition-colors group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{bp.icon}</span>
                      <div>
                        <h3 className="text-sm font-semibold">{bp.name}</h3>
                        <span className="text-micro font-mono text-muted-foreground">{bp.model}</span>
                      </div>
                    </div>
                    <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{bp.role}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{bp.description}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {bp.traits.map(t => (
                      <span key={t} className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setDnaTarget(bp)} className="flex items-center gap-1 text-micro text-muted-foreground hover:text-primary"><Dna className="h-3 w-3" /> DNA</button>
                    <button className="flex items-center gap-1 text-micro text-muted-foreground hover:text-primary ml-auto"><Bot className="h-3 w-3" /> Spawn</button>
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
              {conversationSteps.slice(0, step + 1).map((s, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <div className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <Hexagon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-lg bg-card border border-border px-4 py-2.5">
                      <span className="text-sm">{s.question}</span>
                    </div>
                  </div>
                  {answers[i] ? (
                    <div className="flex justify-end">
                      <div className="rounded-lg bg-primary/10 px-4 py-2.5">
                        <span className="text-sm">{answers[i]}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 ml-10">
                      {s.options.map(opt => (
                        <button key={opt} onClick={() => handleAnswer(opt)}
                          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary transition-colors">
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}

              {answers.length === conversationSteps.length && !created && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 ml-10">
                  <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Agent name (e.g. Widget Builder)"
                    className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
                  <button onClick={handleCreate} disabled={!agentName.trim() || creating}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {creating ? 'Forging agent...' : 'Forge Agent'}
                  </button>
                </motion.div>
              )}

              {created && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="rounded-lg border border-success/40 bg-success/5 p-4 ml-10">
                  <div className="flex items-center gap-2 mb-2">
                    <Check className="h-5 w-5 text-success" />
                    <span className="text-sm font-semibold text-success">{agentName} has been forged!</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Role: {answers[0]} · Model: {answers[1]} · Tier: {answers[2]?.split(' — ')[0]} · Autonomy: {answers[3]?.split(' — ')[0]}</p>
                  <button onClick={resetCreator} className="text-xs text-primary hover:underline mt-2">Create another</button>
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
