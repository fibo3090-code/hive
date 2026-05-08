import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { TaskItem } from '@/types/domain';

interface ActiveTasksProps {
  readonly tasks: TaskItem[];
  readonly onToggleStatus: (id: string, status: string) => void;
}

const statusTaskColors: Record<string, string> = {
  'in-progress': 'text-success',
  queued: 'text-muted-foreground',
  completed: 'text-primary',
  blocked: 'text-destructive',
};

export function ActiveTasks({ tasks, onToggleStatus }: ActiveTasksProps) {
  const toggleTaskStatus = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const nextIfInProgress = task.status === 'in-progress' ? 'completed' : task.status;
    const next = task.status === 'queued' ? 'in-progress' : nextIfInProgress;
    if (next !== task.status) {
      onToggleStatus(id, next);
      toast.success(`Task "${task.title}" → ${next}`);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Active Tasks</h3>
        <span className="text-micro text-muted-foreground">{tasks.length} tasks</span>
      </div>
      <div className="divide-y divide-border">
        {tasks.map((task) => {
          const taskButtonColorIfBlocked = task.status === 'blocked' ? 'border-destructive text-destructive' : 'border-border hover:border-primary';
          const taskButtonColorIfInProgress = task.status === 'in-progress' ? 'border-primary text-primary' : taskButtonColorIfBlocked;
          const taskButtonColor = task.status === 'completed' ? 'bg-success/20 border-success text-success' : taskButtonColorIfInProgress;
          const taskPriorityColorIfMedium = task.priority === 'medium' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground';
          const taskPriorityColor = task.priority === 'high' ? 'bg-destructive/10 text-destructive' : taskPriorityColorIfMedium;
          return (
            <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors group">
              <button onClick={() => toggleTaskStatus(task.id)}
                className={cn('h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors', taskButtonColor)}>
                {task.status === 'completed' && <Check className="h-3 w-3" />}
                {task.status === 'in-progress' && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {task.status === 'blocked' && <X className="h-3 w-3" />}
              </button>
              <span className={cn('text-xs font-medium w-24 capitalize', statusTaskColors[task.status])}>{task.status}</span>
              <span className={cn('text-sm flex-1 truncate', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.title}</span>
              <span className={cn('text-micro px-1.5 py-0.5 rounded', taskPriorityColor)}>{task.priority}</span>
              <span className="text-xs text-muted-foreground">{task.assignee}</span>
              <span className="text-micro font-mono text-muted-foreground">{((task.estimatedTokens ?? 0) / 1000).toFixed(0)}k tok</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
