import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/types/domain';

const statusColors: Record<AgentStatus, string> = {
  working: 'bg-success',
  idle: 'bg-muted-foreground',
  blocked: 'bg-destructive',
  paused: 'bg-warning',
  deprecated: 'bg-destructive/50',
};

interface StatusDotProps {
  readonly status: AgentStatus;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly pulse?: boolean;
  readonly className?: string;
}

export function StatusDot({ status, size = 'md', pulse, className }: StatusDotProps) {
  const sizeClass = { sm: 'h-1.5 w-1.5', md: 'h-2 w-2', lg: 'h-3 w-3' }[size];
  return (
    <span
      className={cn(
        'inline-block rounded-full',
        sizeClass,
        statusColors[status],
        (pulse || status === 'working') && 'animate-status-pulse',
        className
      )}
      title={status}
    />
  );
}
