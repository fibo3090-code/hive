import { useMemo } from 'react';
import { useSprintsData } from '@/api/queries/useServerData';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CheckCircle2, Play, Pause, Circle } from 'lucide-react';
import type { TaskItem } from '@/types/domain';

type GanttStatus = 'completed' | 'in-progress' | 'blocked' | 'queued';

interface SprintTimelineProps {
  readonly projectId: string | null | undefined;
  readonly tasks: TaskItem[];
}

export function SprintTimeline({ projectId, tasks: allTasks }: SprintTimelineProps) {
  const sprintsQuery = useSprintsData(projectId);
  const activeSprint =
    sprintsQuery.data?.find((s) => s.status === 'active') ??
    sprintsQuery.data?.[0] ??
    null;

  if (!activeSprint) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
        {sprintsQuery.isLoading ? 'Loading sprint…' : 'No active sprint. Plan one in /spec to populate the timeline.'}
      </div>
    );
  }

  const startIso = activeSprint.startDate ?? activeSprint.start_date ?? null;
  const endIso = activeSprint.endDate ?? activeSprint.end_date ?? null;
  const startDate = startIso ? new Date(startIso) : null;
  const endDate = endIso ? new Date(endIso) : null;
  const totalDays = startDate && endDate ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000)) : 14;
  const today = new Date();
  const currentDay = startDate ? Math.max(0, Math.min(totalDays, Math.round((today.getTime() - startDate.getTime()) / 86400000))) : 0;
  const progressPct = totalDays > 0 ? (currentDay / totalDays) * 100 : 0;

  const sprintTasks = allTasks.filter((t) => t.sprintId === activeSprint.id);
  const ganttRows = sprintTasks.length > 0
    ? sprintTasks.map((task, idx, all) => {
        const slice = totalDays / Math.max(1, all.length);
        const start = Math.round(idx * slice);
        const end = Math.min(totalDays, Math.round((idx + 1) * slice));
        const status = (task.status as GanttStatus) ?? 'queued';
        return { name: task.title, start, end, status, assignee: task.assignee };
      })
    : [];

  const statusColors: Record<GanttStatus, string> = {
    completed: 'bg-success/70 border-success/50',
    'in-progress': 'bg-primary/60 border-primary/40',
    blocked: 'bg-destructive/50 border-destructive/40',
    queued: 'bg-muted/40 border-border',
  };
  const statusIcons: Record<GanttStatus, any> = {
    completed: CheckCircle2,
    'in-progress': Play,
    blocked: Pause,
    queued: Circle,
  };

  const dates = startDate
    ? Array.from({ length: 8 }, (_, i) => {
        const d = new Date(startDate.getTime() + (i * totalDays * 86400000) / 8);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      })
    : Array.from({ length: 8 }, (_, i) => `Day ${Math.round((i * totalDays) / 8)}`);

  const sprintTitle = activeSprint.name || `Sprint ${activeSprint.position ?? ''}`.trim();
  const sprintProgressPct = typeof activeSprint.progress === 'number' ? activeSprint.progress : Math.round(progressPct);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">{sprintTitle} Timeline</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">Day {currentDay}/{totalDays}</span>
        </div>
        <div className="flex items-center gap-3 text-micro text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success/70" /> Done</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/60" /> Active</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-destructive/50" /> Blocked</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-muted/40" /> Queued</span>
        </div>
      </div>
      <div className="px-4 py-4">
        <div className="flex ml-[140px] mb-2">
          {dates.map((d) => <span key={d} className="text-micro text-muted-foreground/60 font-mono" style={{ width: `${100 / 8}%` }}>{d}</span>)}
        </div>
        <div className="space-y-1.5">
          {ganttRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-micro text-muted-foreground">
              No tasks scheduled in this sprint yet.
            </div>
          ) : (
            ganttRows.map((task) => {
              const StatusIcon = statusIcons[task.status];
              const leftPct = (task.start / totalDays) * 100;
              const widthPct = ((task.end - task.start) / totalDays) * 100;
              const ganttStatusColorMap: Record<string, string> = { completed: 'text-success', 'in-progress': 'text-primary', blocked: 'text-destructive' };
              const ganttStatusColor = ganttStatusColorMap[task.status] ?? 'text-muted-foreground';
              return (
                <div key={`${task.name}-${task.start}`} className="flex items-center group">
                  <div className="w-[140px] shrink-0 flex items-center gap-2 pr-3">
                    <StatusIcon className={cn('h-3 w-3 shrink-0', ganttStatusColor)} />
                    <span className="text-micro text-muted-foreground truncate">{task.name}</span>
                  </div>
                  <div className="flex-1 relative h-6">
                    <div className={cn('absolute top-0.5 bottom-0.5 rounded-sm border transition-all cursor-pointer hover:brightness-125 hover:shadow-sm', statusColors[task.status])} style={{ left: `${leftPct}%`, width: `${widthPct}%` }} title={`${task.name} — ${task.assignee}`}>
                      <span className="text-[9px] font-medium text-foreground/80 px-1.5 leading-5 truncate block">{task.assignee}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="relative ml-[140px] mt-1">
          <div className="absolute top-0 h-1 w-px" style={{ left: `${progressPct}%` }}>
            <div className="absolute -top-[calc(100%+0.5rem)] bottom-0 w-px bg-primary" style={{ height: `${Math.max(1, ganttRows.length) * 28 + 8}px`, transform: 'translateY(-100%)' }} />
            <span className="absolute -top-3 -translate-x-1/2 rounded bg-primary px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary-foreground whitespace-nowrap">Now</span>
          </div>
        </div>
        <div className="mt-4 ml-[140px] flex items-center gap-3">
          <Progress value={sprintProgressPct} className="h-1.5 flex-1" />
          <span className="text-micro font-mono text-muted-foreground">{sprintProgressPct}% complete</span>
        </div>
      </div>
    </div>
  );
}
