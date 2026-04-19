import { cn } from '@/lib/utils';
import { Shield, Cloud, Server } from 'lucide-react';
import type { SovereigntyTier } from '@/types/domain';

const tierConfig: Record<SovereigntyTier, { icon: typeof Shield; label: string; className: string }> = {
  local: { icon: Server, label: 'Local', className: 'text-success border-success/30 bg-success/10' },
  hybrid: { icon: Shield, label: 'Hybrid', className: 'text-warning border-warning/30 bg-warning/10' },
  cloud: { icon: Cloud, label: 'Cloud', className: 'text-info border-info/30 bg-info/10' },
};

interface SovereigntyBadgeProps {
  readonly tier: SovereigntyTier;
  readonly className?: string;
}

export function SovereigntyBadge({ tier, className }: SovereigntyBadgeProps) {
  const config = tierConfig[tier];
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium', config.className, className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
