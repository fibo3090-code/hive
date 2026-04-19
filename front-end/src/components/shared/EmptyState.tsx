import { cn } from '@/lib/utils';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  readonly icon?: React.ElementType;
  readonly title: string;
  readonly description: string;
  readonly action?: { label: string; onClick: () => void };
  readonly className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      <div className="rounded-full bg-surface-2 p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-4">{description}</p>
      {action && (
        <button onClick={action.onClick} className="rounded-md bg-primary/10 px-4 py-2 text-xs text-primary hover:bg-primary/20 transition-colors">
          {action.label}
        </button>
      )}
    </div>
  );
}
