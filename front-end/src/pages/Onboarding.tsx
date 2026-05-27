import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { FileCode, Layout, Upload, ChevronRight, Check, Loader2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useHiveData } from '@/api/queries/useHiveData';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { StepConnectLlms } from './onboarding/StepConnectLlms';
import { StepCoordinatorChat } from './onboarding/StepCoordinatorChat';
import type { SovereigntyTier } from '@/types/domain';
import type { PlanGraphPayload } from '@/api/planGraph';
import { SprintPlanExplorer } from '@/components/planning/SprintPlanExplorer';

type GenesisPlanPreview = PlanGraphPayload;

// Phase 2 of the redesign: insert Connect-LLMs as step 2, between
// Budget and the CEO Describe chat. The total length stays in lockstep
// with the `nextStep`/`prevStep` clamps below — keep them in sync if
// you ever add or remove a step.
const steps = ['Source', 'Budget', 'Connect LLMs', 'Describe', 'Plan Review'];
const LAST_STEP_INDEX = steps.length - 1;
const PLAN_REVIEW_INDEX = LAST_STEP_INDEX;

export default function Onboarding() {
  const navigate = useNavigate();
  const { onboardingDraft, updateOnboardingDraft, resetOnboardingDraft } = useWorkspace();
  const { addProject, setActiveProject } = useHiveData();

  type LaunchStep = { name: string; status: string; detail: string };
  const [launch, setLaunch] = useState<{ phase: 'idle' | 'running' | 'done'; steps: LaunchStep[] }>({ phase: 'idle', steps: [] });

  const step = onboardingDraft.step;
  const nextStep = () => updateOnboardingDraft((draft) => ({ ...draft, step: Math.min(draft.step + 1, LAST_STEP_INDEX) }));
  const prevStep = () => updateOnboardingDraft((draft) => ({ ...draft, step: Math.max(draft.step - 1, 0) }));

  const LAUNCH_STEP_NAMES = ['provision-workspace', 'migrate-db', 'probe-search', 'spec-document', 'decompose-plan'];

  /**
   * B1: create the project *before* the Describe step so the CEO chat has
   * somewhere to live. Called when the operator advances onto step 3.
   * Idempotent — if `onboardingDraft.projectId` is already set we just
   * promote it to active and return; the project survives a mid-onboarding
   * refresh. The full launch (workspace provision + spec doc + decompose)
   * still happens at the final Launch click.
   */
  const ensureProjectForChat = async (): Promise<string | null> => {
    if (onboardingDraft.projectId) {
      await setActiveProject(onboardingDraft.projectId).catch(() => undefined);
      return onboardingDraft.projectId;
    }
    const sourceDefaultName =
      onboardingDraft.source === 'import'
        ? 'Imported Workspace'
        : onboardingDraft.source === 'template'
          ? 'Template Workspace'
          : 'New Hive Project';
    try {
      const project = await addProject({
        name: sourceDefaultName,
        description: 'Created during onboarding — brief in progress',
        sovereigntyTier: onboardingDraft.tier,
        budgetTotalCents: onboardingDraft.budget * 100,
        status: 'active',
      });
      await setActiveProject(project.id).catch(() => undefined);
      updateOnboardingDraft({ projectId: project.id });
      return project.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create project — see the backend logs.');
      return null;
    }
  };

  const launchProject = async () => {
    if (launch.phase === 'running') return;
    const trimmedDescription = onboardingDraft.description.trim();
    // The project should have been created at the Describe-step entry.
    // Fall back to creating it here just in case the user skipped the
    // chat step entirely (e.g. deep-linked into Plan Review).
    let projectId = onboardingDraft.projectId;
    setLaunch({
      phase: 'running',
      steps: LAUNCH_STEP_NAMES.map((name) => ({ name, status: 'running', detail: '' })),
    });
    try {
      if (!projectId) {
        const created = await ensureProjectForChat();
        if (!created) {
          setLaunch({ phase: 'idle', steps: [] });
          return;
        }
        projectId = created;
      }
      // Refine the project name from the brief if we have one — replaces the
      // placeholder set at chat-step entry. Best-effort.
      if (trimmedDescription) {
        const renamed = trimmedDescription
          .split(/\s+/)
          .slice(0, 3)
          .join(' ')
          .replace(/[^\w\s-]/g, '')
          .trim();
        if (renamed) {
          await api<unknown>(`/v1/projects/${projectId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: renamed, description: trimmedDescription }),
          }).catch(() => undefined);
        }
      }
      const result = await api<{ steps: LaunchStep[]; taskCount: number }>(`/v1/projects/${projectId}/launch`, {
        method: 'POST',
        body: JSON.stringify({
          description: trimmedDescription || undefined,
          decompose: trimmedDescription.length > 0,
          planGraph: onboardingDraft.planGraph ?? undefined,
        }),
      });
      setLaunch({ phase: 'done', steps: result.steps.length ? result.steps : LAUNCH_STEP_NAMES.map((name) => ({ name, status: 'ok', detail: '' })) });
      resetOnboardingDraft();
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Launch failed — see the backend logs.');
      setLaunch({ phase: 'idle', steps: [] });
    }
  };

  // When the operator transitions onto the Describe (chat) step, make sure
  // the project exists so the chat has a home. Runs once per draft (the
  // `if (projectId)` guard in `ensureProjectForChat` makes repeat calls no-op).
  useEffect(() => {
    if (step === 3 && !onboardingDraft.projectId) {
      void ensureProjectForChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, onboardingDraft.projectId]);

  const STEP_LABELS: Record<string, string> = {
    'provision-workspace': 'Provisioning workspace + git repo',
    'migrate-db': 'Verifying database schema',
    'probe-search': 'Probing search backend',
    'spec-document': 'Saving project brief',
    'decompose-plan': 'Decomposing brief into sprints + tasks',
  };

  if (launch.phase !== 'idle') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-1">
            {launch.phase === 'running'
              ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
              : <Check className="h-4 w-4 text-success" />}
            <h2 className="text-base font-semibold">
              {launch.phase === 'running' ? 'Launching project…' : 'Project ready'}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            {launch.phase === 'running' ? 'Provisioning the workspace and planning the work.' : 'Opening the dashboard…'}
          </p>
          <ul className="space-y-2">
            {launch.steps.map((s) => {
              const isOk = s.status === 'ok';
              const isWarn = s.status === 'warn';
              const isSkipped = s.status === 'skipped';
              return (
                <li key={s.name} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5">
                    {s.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      : isOk ? <Check className="h-3.5 w-3.5 text-success" />
                      : isWarn ? <span className="text-warning font-bold">!</span>
                      : isSkipped ? <span className="text-muted-foreground">–</span>
                      : <Check className="h-3.5 w-3.5 text-muted-foreground" />}
                  </span>
                  <span className="flex-1">
                    <span className={cn('font-medium', isWarn && 'text-warning', isSkipped && 'text-muted-foreground')}>
                      {STEP_LABELS[s.name] ?? s.name}
                    </span>
                    {s.detail && <span className="block text-muted-foreground">{s.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <div className="flex items-center gap-2 mb-12">
        {steps.map((label, index) => {
          const stepCircleColorIfCurrent = index === step ? 'bg-primary/20 text-primary border-2 border-primary' : 'bg-surface-2 text-muted-foreground';
          const stepCircleColor = index < step ? 'bg-primary text-primary-foreground' : stepCircleColorIfCurrent;
          const stepContent = index < step ? <Check className="h-3.5 w-3.5" /> : index + 1;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all', stepCircleColor)}>
                {stepContent}
              </div>
              <span className={cn('text-xs hidden sm:block', index === step ? 'text-foreground font-medium' : 'text-muted-foreground')}>{label}</span>
              {index < steps.length - 1 && <div className={cn('h-px w-8', index < step ? 'bg-primary' : 'bg-border')} />}
            </div>
          );
        })}
      </div>

      <div className="w-full max-w-2xl animate-fade-in">
        {step === 0 && (
          <StepSource
            source={onboardingDraft.source}
            onSelect={(source) => updateOnboardingDraft({ source })}
          />
        )}
        {step === 1 && (
          <StepBudget
            budget={onboardingDraft.budget}
            agents={onboardingDraft.agents}
            tier={onboardingDraft.tier}
            onBudgetChange={(budget) => updateOnboardingDraft({ budget })}
            onAgentsChange={(agents) => updateOnboardingDraft({ agents })}
            onTierChange={(tier) => updateOnboardingDraft({ tier })}
          />
        )}
        {step === 2 && (
          <StepConnectLlms
            connectedProviderIds={onboardingDraft.connectedProviderIds}
            onChange={(connectedProviderIds) =>
              updateOnboardingDraft({ connectedProviderIds })
            }
          />
        )}
        {step === 3 && (
          <>
            <StepCoordinatorChat
              projectId={onboardingDraft.projectId}
              teamMode={onboardingDraft.teamMode}
              coordinatorThreadId={onboardingDraft.coordinatorThreadId}
              onThreadResolved={(threadId) => updateOnboardingDraft({ coordinatorThreadId: threadId })}
              description={onboardingDraft.description}
              uploadedSpecName={onboardingDraft.uploadedSpecName}
              onDescriptionChange={(description) => updateOnboardingDraft({ description })}
              onSpecUpload={(file) =>
                updateOnboardingDraft({
                  uploadedSpecName: file.name,
                  // Use the spec text as the description so the genesis
                  // preview is grounded in it. Cap at 32 KB to keep
                  // request payloads sane.
                  description: file.text.slice(0, 32 * 1024),
                })
              }
            />
            <TeamModeToggle
              teamMode={onboardingDraft.teamMode}
              onChange={(teamMode) => updateOnboardingDraft({ teamMode })}
            />
          </>
        )}
        {step === PLAN_REVIEW_INDEX && (
          <StepPlanReview
            source={onboardingDraft.source}
            budget={onboardingDraft.budget}
            agents={onboardingDraft.agents}
            tier={onboardingDraft.tier}
            description={onboardingDraft.description}
            planGraph={onboardingDraft.planGraph}
            onPlanGraphChange={(planGraph) => updateOnboardingDraft({ planGraph })}
          />
        )}

      </div>

      <div className="flex gap-3 mt-8">
        {step > 0 && <Button variant="outline" onClick={prevStep}>Back</Button>}
        <Button
          onClick={step === PLAN_REVIEW_INDEX ? () => { void launchProject(); } : nextStep}
          className="gap-1.5"
        >
          {step === PLAN_REVIEW_INDEX ? 'Launch' : 'Next'} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function StepSource({
  source,
  onSelect,
}: {
  readonly source: 'scratch' | 'template' | 'import' | null;
  readonly onSelect: (source: 'scratch' | 'template' | 'import') => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <h2 className="text-display-sm">How would you like to start?</h2>
      <p className="text-sm text-muted-foreground">Choose how to initialize your project</p>
      <div className="grid grid-cols-3 gap-4">
        {[
          { id: 'scratch' as const, icon: FileCode, title: 'From Scratch', desc: 'Start with an empty project', disabledReason: null },
          { id: 'template' as const, icon: Layout, title: 'Template', desc: 'Use a pre-built template', disabledReason: 'Requires the Hive central server (not yet available). Coming in a later release.' },
          { id: 'import' as const, icon: Upload, title: 'Import', desc: 'Import existing codebase', disabledReason: 'Local-only feature, but not yet implemented. Planned for a future release.' },
        ].map((option) => (
          <button
            key={option.id}
            onClick={() => option.disabledReason ? undefined : onSelect(option.id)}
            title={option.disabledReason ?? undefined}
            disabled={option.disabledReason !== null}
            className={cn(
              'relative rounded-xl border p-6 text-center transition-all',
              source === option.id ? 'border-primary bg-primary/5 glow-amber' : 'border-border bg-card',
              option.disabledReason ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/40 cursor-pointer',
            )}
          >
            {option.disabledReason && (
              <div className="absolute top-2 right-2 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                {option.id === 'template' ? 'Server-only' : 'Planned'}
              </div>
            )}
            <option.icon className={cn('h-8 w-8 mx-auto mb-3', source === option.id ? 'text-primary' : 'text-muted-foreground')} />
            <h3 className="text-sm font-semibold mb-1">{option.title}</h3>
            <p className="text-micro text-muted-foreground">{option.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepBudget({
  budget,
  agents,
  tier,
  onBudgetChange,
  onAgentsChange,
  onTierChange,
}: {
  readonly budget: number;
  readonly agents: number;
  readonly tier: SovereigntyTier;
  readonly onBudgetChange: (budget: number) => void;
  readonly onAgentsChange: (agents: number) => void;
  readonly onTierChange: (tier: SovereigntyTier) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-display-sm">Configure Resources</h2>
        <p className="text-sm text-muted-foreground mt-1">Set your budget and agent limits</p>
      </div>

      <div className="space-y-6">
        <div>
          <label htmlFor="onboarding-budget" className="text-sm font-medium">Session Budget</label>
          <p className="text-xs text-muted-foreground mb-3">Maximum spend per session</p>
          <div className="flex items-center gap-4">
            <Slider id="onboarding-budget" value={[budget]} onValueChange={([value]) => onBudgetChange(value)} min={10} max={500} step={10} className="flex-1" />
            <span className="text-lg font-mono font-semibold text-primary w-16 text-right">${budget}</span>
          </div>
        </div>

        <div>
          <label htmlFor="onboarding-agents" className="text-sm font-medium">Max Parallel Running Agents</label>
          <p className="text-xs text-muted-foreground mb-3">Number of concurrent agents</p>
          <div className="flex items-center gap-3">
            <button onClick={() => onAgentsChange(Math.max(1, agents - 1))} className="h-8 w-8 rounded border border-border text-sm hover:bg-surface-2">-</button>
            <span id="onboarding-agents" className="text-lg font-mono font-semibold w-8 text-center">{agents}</span>
            <button onClick={() => onAgentsChange(Math.min(12, agents + 1))} className="h-8 w-8 rounded border border-border text-sm hover:bg-surface-2">+</button>
          </div>
        </div>

        <div>
          <label htmlFor="onboarding-tier" className="text-sm font-medium">Sovereignty Tier</label>
          <p className="text-xs text-muted-foreground mb-3">Data processing location</p>
          <div id="onboarding-tier" className="flex gap-2">
            <button onClick={() => onTierChange('local')} className={cn('rounded-lg border px-4 py-2 text-xs capitalize transition-all', tier === 'local' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
              Local
            </button>
            <button disabled className="rounded-lg border px-4 py-2 text-xs capitalize transition-all border-border text-muted-foreground opacity-50 cursor-not-allowed" title="Coming Soon (Enterprise)">
              Cloud <span className="ml-1 text-[10px] uppercase text-muted-foreground/70 tracking-wider">Coming Soon</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// `StepDescribe` was the old textarea-only Describe step; replaced by
// `StepCoordinatorChat` (CEO chat + "Skip — paste a brief" fallback that
// reuses the same textarea inside that component).

function StepPlanReview({
  source,
  budget,
  agents,
  tier,
  description,
  planGraph,
  onPlanGraphChange,
}: {
  readonly source: 'scratch' | 'template' | 'import' | null;
  readonly budget: number;
  readonly agents: number;
  readonly tier: SovereigntyTier;
  readonly description: string;
  readonly planGraph: PlanGraphPayload | null;
  readonly onPlanGraphChange: (plan: PlanGraphPayload) => void;
}) {
  // Real preview from the backend, grounded in the user's description.
  const previewQuery = useQuery({
    queryKey: ['genesis-preview', description, agents],
    queryFn: () =>
      api<GenesisPlanPreview>('/v1/projects/genesis/preview', {
        method: 'POST',
        body: JSON.stringify({ description, agentCount: agents }),
      }),
    enabled: description.trim().length > 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (previewQuery.data && !planGraph) {
      onPlanGraphChange(previewQuery.data);
    }
  }, [onPlanGraphChange, planGraph, previewQuery.data]);

  const activePlan = planGraph ?? previewQuery.data ?? null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-display-sm">Review Your Plan</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {previewQuery.isLoading
            ? 'Generating plan…'
            : 'The hive has generated your project plan'}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
        <div><span className="text-foreground font-medium">Source:</span> {source ?? 'scratch'}</div>
        <div><span className="text-foreground font-medium">Budget:</span> ${budget}</div>
        <div><span className="text-foreground font-medium">Agents:</span> {agents}</div>
        <div><span className="text-foreground font-medium">Tier:</span> {tier}</div>
        {description && <div><span className="text-foreground font-medium">Brief:</span> {description}</div>}
      </div>

      <div className="space-y-3">
        {previewQuery.isLoading && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
            Generating plan from your description…
          </div>
        )}
        {previewQuery.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-xs">
            <div className="font-medium text-destructive mb-1">
              Couldn't generate the plan.
            </div>
            <div className="text-muted-foreground mb-2">
              {previewQuery.error instanceof Error
                ? previewQuery.error.message
                : 'Unknown error'}
            </div>
            <button
              type="button"
              onClick={() => void previewQuery.refetch()}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-2"
            >
              Retry
            </button>
          </div>
        )}
        {!previewQuery.isLoading && !previewQuery.isError && !activePlan && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Add a description to see a generated plan.
          </div>
        )}
        {activePlan && (
          <SprintPlanExplorer
            plan={activePlan}
            editable
            onChange={onPlanGraphChange}
          />
        )}
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
        <span className="text-sm font-medium">
          {agents} max parallel agents • {activePlan?.sprintNodes.length ?? 0} mini-sprints • {activePlan?.taskNodes.length ?? 0} tasks
        </span>
      </div>
    </div>
  );
}



// Phase 2: Team-mode toggle for the CEO chat. When ON, the CEO is
// allowed to delegate to its base team (research / architect / product
// blueprints — added by the runtime side of Phase 1b). When OFF, it
// works alone with degraded research quality. We only persist the
// preference here; the runtime reads it on `/coordinator/converse`.
function TeamModeToggle({
  teamMode,
  onChange,
}: {
  readonly teamMode: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Users className={cn('mt-0.5 h-5 w-5', teamMode ? 'text-primary' : 'text-muted-foreground')} />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold">Team mode</h3>
            <button
              type="button"
              role="switch"
              aria-checked={teamMode}
              onClick={() => onChange(!teamMode)}
              className={cn(
                'relative h-5 w-9 rounded-full border transition-colors',
                teamMode
                  ? 'border-primary bg-primary/20'
                  : 'border-border bg-surface-2',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
                  teamMode ? 'left-[18px] bg-primary' : 'left-0.5 bg-muted-foreground',
                )}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            With team mode on, the CEO delegates research and design to specialised
            agents — higher-quality output, slightly higher cost. With it off, the
            CEO works alone using direct web search; faster and cheaper, but the
            spec doc tends to be thinner.
          </p>
        </div>
      </div>
    </div>
  );
}
