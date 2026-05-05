import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  GripVertical,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';
import { useHiveData } from '@/api/queries/useHiveData';
import {
  useReorderSprints,
  useRequirementsData,
  useSprintsData,
  useUserStoriesData,
} from '@/api/queries/useServerData';
import type { RequirementItem, SprintPlanItem, UserStoryItem } from '@/types/domain';
import { toast } from 'sonner';

const tabs = [
  { id: 'prd', label: 'PRD', icon: FileText },
  { id: 'stories', label: 'User Stories', icon: BookOpen },
  { id: 'sprint', label: 'Sprint Plan', icon: CalendarDays },
  { id: 'drift', label: 'Spec Drift', icon: AlertTriangle },
  { id: 'status', label: 'Implementation', icon: CheckSquare },
] as const;

const statusColors: Record<string, string> = {
  implemented: 'text-success',
  'in-progress': 'text-warning',
  planned: 'text-muted-foreground',
  done: 'text-success',
  active: 'text-primary',
  completed: 'text-success',
};

const sprintCardStyles: Record<string, string> = {
  active: 'border-primary/30 bg-primary/5',
  completed: 'border-success/30 bg-success/5',
  planned: 'border-border',
};

function EmptyState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export default function SpecPlan() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('prd');

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors',
              tab === item.id
                ? 'bg-primary/10 text-primary border-r-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {tab === 'prd' && <PRDTab />}
        {tab === 'stories' && <StoriesTab />}
        {tab === 'sprint' && <SprintTab />}
        {tab === 'drift' && <DriftTab />}
        {tab === 'status' && <StatusTab />}
      </div>
    </div>
  );
}

function usePlanningData() {
  const { activeProject } = useHiveData();
  const projectId = activeProject?.id ?? null;

  const requirements = useRequirementsData(projectId);
  const stories = useUserStoriesData(projectId);
  const sprints = useSprintsData(projectId);
  const reorderSprints = useReorderSprints(projectId);

  return { projectId, requirements, stories, sprints, reorderSprints };
}

function PRDTab() {
  const { requirements } = usePlanningData();
  const [expanded, setExpanded] = useState<string | null>(null);
  const items = requirements.data ?? [];

  if (items.length === 0) {
    return <EmptyState title="No requirements loaded" message="Requirements will appear here once the backend has a plan for the active project." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Product Requirements Document</h2>
        <span className="text-xs text-muted-foreground">{items.length} tracked requirements</span>
      </div>
      <div className="space-y-2">
        {items.map((req: RequirementItem) => {
          const drift = Boolean(req.driftDetected ?? req.drift);
          const status = req.status ?? 'planned';
          return (
            <div
              key={req.id}
              className={cn(
                'rounded-lg border bg-card overflow-hidden transition-colors',
                drift ? 'border-warning/40' : 'border-border',
                expanded === req.id && 'border-primary/30'
              )}
            >
              <button
                onClick={() => setExpanded(expanded === req.id ? null : req.id)}
                aria-expanded={expanded === req.id}
                aria-controls={`req-body-${req.id}`}
                className="flex items-center gap-3 w-full p-4 text-left hover:bg-surface-2/50 transition-colors"
              >
                {expanded === req.id ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                )}
                <span className="text-micro font-mono text-muted-foreground">{req.code ?? req.id}</span>
                <span className="text-sm font-medium flex-1">{req.title}</span>
                <span className={cn('text-micro font-medium', statusColors[status] ?? 'text-muted-foreground')}>{status}</span>
                {drift && <span className="text-micro text-warning bg-warning/10 px-2 py-0.5 rounded-full">drift</span>}
                <span className="text-micro text-muted-foreground">§{req.section ?? '—'}</span>
              </button>
              <AnimatePresence>
                {expanded === req.id && (
                  <motion.div id={`req-body-${req.id}`} initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 border-t border-border">
                      <p className="text-sm text-muted-foreground mt-3">{req.description}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StoriesTab() {
  const { stories } = usePlanningData();
  const items = stories.data ?? [];

  if (items.length === 0) {
    return <EmptyState title="No user stories yet" message="User stories will appear here when the active project has planning data." />;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">User Stories</h2>
      <div className="space-y-3">
        {items.map((story: UserStoryItem) => {
          const criteria = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria : [];
          return (
            <div key={story.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-micro font-mono text-muted-foreground">{story.code ?? story.id}</span>
                <span className="text-sm font-medium flex-1">{story.title}</span>
                <span className={cn('text-micro font-medium', statusColors[story.status] ?? 'text-muted-foreground')}>{story.status}</span>
                <span className="text-micro font-mono text-primary">{story.points ?? 0} pts</span>
              </div>
              <div className="pl-16 space-y-1">
                {criteria.map((criterion: string) => (
                  <div key={criterion} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckSquare className={cn('h-3 w-3', story.status === 'done' ? 'text-success' : 'text-muted-foreground/40')} />
                    {criterion}
                  </div>
                ))}
              </div>
              <div className="pl-16 mt-3 text-micro text-muted-foreground">{story.sprintLabel ?? story.sprint ?? 'Unscheduled sprint'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SprintTab() {
  const { sprints, reorderSprints } = usePlanningData();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const items = sprints.data ?? [];

  const handleDrop = async (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;

    try {
      await reorderSprints.mutateAsync({ fromId: draggedId, toId: targetId });
      toast.success('Sprint order updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to reorder sprints');
    } finally {
      setDraggedId(null);
    }
  };

  if (items.length === 0) {
    return <EmptyState title="No sprint plan yet" message="Sprint planning data will show up here when the backend has active or scheduled sprints." />;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Sprint Plan</h2>
      <div className="space-y-3">
        {items.map((sprint: SprintPlanItem) => (
          <button
            key={sprint.id}
            type="button"
            draggable
            onDragStart={() => setDraggedId(sprint.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void handleDrop(sprint.id)}
            onDragEnd={() => setDraggedId(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDraggedId(sprint.id); }}
            className={cn(
              'flex flex-col w-full text-left rounded-lg border bg-card p-4 cursor-grab active:cursor-grabbing',
              sprintCardStyles[sprint.status] ?? 'border-border'
            )}
          >
            <div className="flex items-center justify-between mb-2 w-full">
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground/40" />
                <h3 className="text-sm font-semibold">{sprint.name}</h3>
                <span className={cn('text-micro font-medium capitalize', statusColors[sprint.status] ?? 'text-muted-foreground')}>
                  {sprint.status}
                </span>
              </div>
              <span className="text-micro text-muted-foreground">
                {sprint.startDate ?? sprint.start_date} — {sprint.endDate ?? sprint.end_date}
              </span>
            </div>
            <div className="flex items-center gap-3 mb-2 w-full">
              <Progress value={sprint.progress ?? 0} className="flex-1 h-1.5" />
              <span className="text-micro font-mono text-muted-foreground">
                {sprint.completed ?? 0}/{sprint.tasks ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-4 text-micro text-muted-foreground">
              <span>{sprint.points ?? 0} story points</span>
              {sprint.velocity ? <span>Velocity: {sprint.velocity} pts/sprint</span> : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DriftTab() {
  const { requirements } = usePlanningData();
  const driftItems = useMemo(
    () => (requirements.data ?? []).filter((item: RequirementItem) => Boolean(item.driftDetected ?? item.drift)),
    [requirements.data]
  );

  if (driftItems.length === 0) {
    return <EmptyState title="No spec drift detected" message="Drift alerts will appear here when the backend flags a mismatch between plan and implementation." />;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Spec Drift Alerts</h2>
      <div className="space-y-3">
        {driftItems.map((item: RequirementItem) => (
          <div key={item.id} className="rounded-lg border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm font-medium flex-1">{item.title}</span>
              <span className="text-micro text-muted-foreground">{item.code ?? item.id}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
            <div className="flex items-center gap-3">
              <span className="text-micro text-muted-foreground">Drift flag active</span>
              <Progress value={72} className="w-24 h-1.5" />
              <span className="text-micro font-mono text-warning">72%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusTab() {
  const { requirements } = usePlanningData();
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const items = requirements.data ?? [];
  const groups = ['implemented', 'in-progress', 'planned'];

  if (items.length === 0) {
    return <EmptyState title="No implementation map yet" message="Status tracking will appear here once requirements are available for the active project." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Implementation Status</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('table')}
            className={cn('p-1.5 rounded', viewMode === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={cn('p-1.5 rounded', viewMode === 'kanban' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="rounded-lg border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-4 py-2">Requirement</th>
                <th className="text-left px-4 py-2">Section</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Drift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((req: RequirementItem) => (
                <tr key={req.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">{req.title}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">§{req.section ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={cn('text-micro font-medium', statusColors[req.status] ?? 'text-muted-foreground')}>
                      {req.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {req.driftDetected ?? req.drift ? (
                      <span className="text-warning text-micro">drift</span>
                    ) : (
                      <span className="text-success text-micro">ok</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {groups.map((status) => (
            <div key={status}>
              <h4 className={cn('text-xs font-semibold uppercase mb-3', statusColors[status] ?? 'text-muted-foreground')}>{status}</h4>
              <div className="space-y-2">
                {items
                  .filter((req: RequirementItem) => req.status === status)
                  .map((req: RequirementItem) => (
                    <div key={req.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="text-micro font-mono text-muted-foreground mb-1">{req.code ?? req.id}</div>
                      <div className="text-sm font-medium">{req.title}</div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
