import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Bot, GitCommit, AlertTriangle, TestTube2, FileText, DollarSign, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ActivityFeedItem } from '@/types/domain';

const activityIcons = { Bot, GitCommit, AlertTriangle, TestTube2, FileText, DollarSign, Eye } as const;

interface ActivityFeedProps {
  readonly activity: ActivityFeedItem[];
  readonly timeFilter: string;
  readonly onTimeFilterChange: (filter: string) => void;
  readonly showMore: boolean;
  readonly onToggleShowMore: () => void;
}

export function ActivityFeed({ activity, timeFilter, onTimeFilterChange, showMore, onToggleShowMore }: ActivityFeedProps) {
  const displayedActivity = showMore ? activity : activity.slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Activity Feed</h3>
        <div className="flex gap-1">
          {['1h', '6h', '24h'].map((t) => (
            <button key={t} onClick={() => onTimeFilterChange(t)} className={cn('rounded px-2 py-0.5 text-micro transition-colors', t === timeFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>{t}</button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-border">
        {displayedActivity.map((item) => {
          const Icon = activityIcons[item.icon as keyof typeof activityIcons] ?? Bot;
          return (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors cursor-pointer">
              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1">{item.text ?? item.title ?? 'Activity item'}</span>
              <span className="text-micro text-muted-foreground">{item.time ?? item.createdAt ?? 'just now'}</span>
            </div>
          );
        })}
      </div>
      {!showMore && activity.length > 5 && (
        <button onClick={onToggleShowMore} className="w-full py-2 text-xs text-primary hover:underline border-t border-border">
          Load more ({activity.length - 5} more)
        </button>
      )}
    </div>
  );
}
