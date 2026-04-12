import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { Hexagon, FileCode, Layout, Upload, ChevronRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';

const steps = ['Source', 'Budget', 'Describe', 'Plan Review', 'Launch'];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-12">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all',
              i < step ? 'bg-primary text-primary-foreground' :
              i === step ? 'bg-primary/20 text-primary border-2 border-primary' :
              'bg-surface-2 text-muted-foreground'
            )}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span className={cn('text-xs hidden sm:block', i === step ? 'text-foreground font-medium' : 'text-muted-foreground')}>{s}</span>
            {i < steps.length - 1 && <div className={cn('h-px w-8', i < step ? 'bg-primary' : 'bg-border')} />}
          </div>
        ))}
      </div>

      <div className="w-full max-w-2xl animate-fade-in">
        {step === 0 && <StepSource />}
        {step === 1 && <StepBudget />}
        {step === 2 && <StepDescribe />}
        {step === 3 && <StepPlanReview />}
        {step === 4 && <StepLaunch onComplete={() => navigate('/dashboard')} />}
      </div>

      {/* Nav buttons */}
      {step < 4 && (
        <div className="flex gap-3 mt-8">
          {step > 0 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>Back</Button>}
          <Button onClick={() => setStep(s => s + 1)} className="gap-1.5">
            {step === 3 ? 'Launch' : 'Next'} <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function StepSource() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-display-sm">How would you like to start?</h2>
      <p className="text-sm text-muted-foreground">Choose how to initialize your project</p>
      <div className="grid grid-cols-3 gap-4">
        {[
          { id: 'scratch', icon: FileCode, title: 'From Scratch', desc: 'Start with an empty project' },
          { id: 'template', icon: Layout, title: 'Template', desc: 'Use a pre-built template' },
          { id: 'import', icon: Upload, title: 'Import', desc: 'Import existing codebase' },
        ].map(opt => (
          <button
            key={opt.id}
            onClick={() => setSelected(opt.id)}
            className={cn('rounded-xl border p-6 text-center transition-all hover:border-primary/40',
              selected === opt.id ? 'border-primary bg-primary/5 glow-amber' : 'border-border bg-card'
            )}
          >
            <opt.icon className={cn('h-8 w-8 mx-auto mb-3', selected === opt.id ? 'text-primary' : 'text-muted-foreground')} />
            <h3 className="text-sm font-semibold mb-1">{opt.title}</h3>
            <p className="text-micro text-muted-foreground">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepBudget() {
  const [budget, setBudget] = useState([100]);
  const [agents, setAgents] = useState(4);
  const [tier, setTier] = useState<'local' | 'hybrid' | 'cloud'>('hybrid');
  const estimatedCost = Math.round(agents * 8.5 * (tier === 'local' ? 0.6 : tier === 'hybrid' ? 1 : 1.4));

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-display-sm">Configure Resources</h2>
        <p className="text-sm text-muted-foreground mt-1">Set your budget and agent limits</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="text-sm font-medium">Session Budget</label>
          <p className="text-xs text-muted-foreground mb-3">Maximum spend per session</p>
          <div className="flex items-center gap-4">
            <Slider value={budget} onValueChange={setBudget} min={10} max={500} step={10} className="flex-1" />
            <span className="text-lg font-mono font-semibold text-primary w-16 text-right">${budget[0]}</span>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Max Agents</label>
          <p className="text-xs text-muted-foreground mb-3">Number of concurrent agents</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setAgents(a => Math.max(1, a - 1))} className="h-8 w-8 rounded border border-border text-sm hover:bg-surface-2">-</button>
            <span className="text-lg font-mono font-semibold w-8 text-center">{agents}</span>
            <button onClick={() => setAgents(a => Math.min(12, a + 1))} className="h-8 w-8 rounded border border-border text-sm hover:bg-surface-2">+</button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Sovereignty Tier</label>
          <p className="text-xs text-muted-foreground mb-3">Data processing location</p>
          <div className="flex gap-2">
            {(['local', 'hybrid', 'cloud'] as const).map(t => (
              <button key={t} onClick={() => setTier(t)} className={cn('rounded-lg border px-4 py-2 text-xs capitalize transition-all', tier === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <span className="text-xs text-muted-foreground">Estimated session cost</span>
          <span className="block text-xl font-mono font-bold text-primary mt-1">${estimatedCost}</span>
          <span className="text-micro text-muted-foreground">{agents} agents × ~$8.50/agent ({tier} tier)</span>
        </div>
      </div>
    </div>
  );
}

function StepDescribe() {
  const [mode, setMode] = useState<'interview' | 'import'>('interview');
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-display-sm">Describe Your Project</h2>
        <p className="text-sm text-muted-foreground mt-1">Tell us what you want to build</p>
      </div>

      <div className="flex gap-2 justify-center">
        <button onClick={() => setMode('interview')} className={cn('rounded-lg border px-4 py-2 text-xs', mode === 'interview' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
          Interview Mode
        </button>
        <button onClick={() => setMode('import')} className={cn('rounded-lg border px-4 py-2 text-xs', mode === 'import' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
          Import Spec
        </button>
      </div>

      {mode === 'interview' ? (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Hexagon className="h-4 w-4 text-primary" />
            </div>
            <div className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm">
              What type of application are you building? (e.g., web app, API, mobile backend, data pipeline)
            </div>
          </div>
          <textarea className="w-full rounded-lg border border-border bg-surface-2 p-3 text-sm placeholder:text-muted-foreground resize-none h-24" placeholder="Type your answer..." />
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-border bg-card/50 p-12 text-center hover:border-primary/40 transition-colors cursor-pointer">
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Drop your spec document here</p>
          <p className="text-micro text-muted-foreground mt-1">.md, .txt, .pdf, .docx</p>
        </div>
      )}
    </div>
  );
}

function StepPlanReview() {
  const mockPlan = [
    { phase: 'Phase 1', tasks: ['Set up project structure', 'Configure authentication', 'Design database schema'], status: 'ready' },
    { phase: 'Phase 2', tasks: ['Build API endpoints', 'Implement CRUD operations', 'Add input validation'], status: 'ready' },
    { phase: 'Phase 3', tasks: ['Create frontend components', 'Integrate with API', 'Add real-time updates'], status: 'ready' },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-display-sm">Review Your Plan</h2>
        <p className="text-sm text-muted-foreground mt-1">The hive has generated your project plan</p>
      </div>

      <div className="space-y-3">
        {mockPlan.map((phase) => (
          <div key={phase.phase} className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-2">{phase.phase}</h3>
            <div className="space-y-1">
              {phase.tasks.map(task => (
                <div key={task} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                  {task}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
        <span className="text-sm font-medium">Estimated: 6 agents • ~$85 • 3 phases</span>
      </div>
    </div>
  );
}

function StepLaunch({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const items = ['Initializing workspace...', 'Spawning agents...', 'Loading modules...', 'Starting session...', 'Ready!'];

  useState(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setProgress(Math.min(i * 25, 100));
      if (i >= 5) {
        clearInterval(interval);
        setTimeout(onComplete, 1000);
      }
    }, 800);
    return () => clearInterval(interval);
  });

  return (
    <div className="space-y-8 text-center">
      <h2 className="text-display-sm">Launching Your Hive</h2>
      <Progress value={progress} className="h-2 max-w-md mx-auto" />
      <div className="space-y-2">
        {items.map((item, i) => {
          const isComplete = progress >= (i + 1) * 20;
          const isCurrent = !isComplete && progress >= i * 20;
          return (
            <div key={i} className={cn('flex items-center gap-3 justify-center transition-all', isComplete ? 'text-success' : isCurrent ? 'text-foreground' : 'text-muted-foreground/40')}>
              {isComplete ? <Check className="h-4 w-4" /> : isCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : <div className="h-4 w-4" />}
              <span className="text-sm">{item}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
