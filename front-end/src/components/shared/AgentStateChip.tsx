import { cn } from '@/lib/utils';
import type { AssignmentState } from '@/api/assignments';

/**
 * Compact pill for the seven assignment states. Surfaces in the planning
 * Skill-Sprint lane and on agent cards. Mirrors `StatusDot` for the
 * 5-state agent runtime status, but adds the assignment-specific
 * `awaiting-authorization` and `requesting-input` UX paths.
 */
const stateClasses: Record<AssignmentState, string> = {
  paused: 'bg-warning/15 text-warning border-warning/30',
  started: 'bg-info/15 text-info border-info/30',
  'in-progress': 'bg-success/15 text-success border-success/30',
  finished: 'bg-muted text-muted-foreground border-border',
  blocked: 'bg-destructive/15 text-destructive border-destructive/30',
  'awaiting-authorization':
    'bg-warning/15 text-warning border-warning/40 ring-1 ring-warning/20',
  'requesting-input':
    'bg-info/15 text-info border-info/40 ring-1 ring-info/20',
};

const stateLabels: Record<AssignmentState, string> = {
  paused: 'Paused',
  started: 'Started',
  'in-progress': 'In progress',
  finished: 'Finished',
  blocked: 'Blocked',
  'awaiting-authorization': 'Needs auth',
  'requesting-input': 'Needs input',
};

interface AgentStateChipProps {
  readonly state: AssignmentState;
  readonly className?: string;
  /** When `true`, emphasises the chip — used for states that ask the
   *  user to do something (auth / input) so they don't get lost in a
   *  long task list. Defaults to true for those states. */
  readonly attention?: boolean;
}

export function AgentStateChip({ state, className, attention }: AgentStateChipProps) {
  const needsAttention =
    attention ?? (state === 'awaiting-authorization' || state === 'requesting-input');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        stateClasses[state],
        needsAttention && 'animate-status-pulse',
        className,
      )}
      role="status"
      aria-label={`Assignment state: ${stateLabels[state]}`}
    >
      {stateLabels[state]}
    </span>
  );
}
