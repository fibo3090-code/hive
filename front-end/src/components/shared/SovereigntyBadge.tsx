import { cn } from '@/lib/utils';
import { Cloud, Server } from 'lucide-react';
import type { SovereigntyTier } from '@/types/domain';

// Hybrid tier was removed in phase 1 (see FEATURE_STATUS.md). We still
// receive legacy `"hybrid"` values from old seed snapshots, so the badge
// gracefully falls back to Local to avoid an undefined-config crash.
const tierConfig: Record<SovereigntyTier, { icon: typeof Server; label: string; className: string }> = {
  local: { icon: Server, label: 'Local', className: 'text-success border-success/30 bg-success/10' },
  cloud: { icon: Cloud, label: 'Cloud', className: 'text-info border-info/30 bg-info/10' },
};

interface SovereigntyBadgeProps {
  readonly tier: SovereigntyTier | string;
  readonly className?: string;
}

export function SovereigntyBadge({ tier, className }: SovereigntyBadgeProps) {
  const config = tierConfig[(tier as SovereigntyTier)] ?? tierConfig.local;
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium', config.className, className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
