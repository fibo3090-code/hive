import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type DisabledFeatureKind = 'planned' | 'server-only';

const DEFAULT_REASONS: Record<DisabledFeatureKind, string> = {
  planned: 'Not implemented yet — planned for a future release.',
  'server-only': 'Requires the Hive central server (not yet available).',
};

interface DisabledFeatureProps {
  /** What to render disabled. It will be visually dimmed and pointer-events disabled. */
  readonly children: ReactNode;
  /** Why it's disabled — shown in the tooltip. Defaults from `kind`. */
  readonly reason?: string;
  /** Picks a default reason + badge label. */
  readonly kind?: DisabledFeatureKind;
  /** Show a small inline badge ("Planned" / "Server-only") next to the content. Default true. */
  readonly showBadge?: boolean;
  readonly className?: string;
}

/**
 * Wrap any control that is intentionally not functional yet. Renders the child
 * dimmed + non-interactive, with a tooltip explaining why and (optionally) a
 * badge. Use this instead of ad-hoc `disabled` + `opacity-50` + `title=` so the
 * "this feature is parked" affordance is consistent across the app.
 */
export function DisabledFeature({
  children,
  reason,
  kind = 'planned',
  showBadge = true,
  className,
}: DisabledFeatureProps) {
  const text = reason ?? DEFAULT_REASONS[kind];
  const badgeLabel = kind === 'server-only' ? 'Server-only' : 'Planned';
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1.5 align-middle cursor-not-allowed', className)}>
            <span className="pointer-events-none opacity-40 select-none">{children}</span>
            {showBadge && (
              <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {badgeLabel}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
