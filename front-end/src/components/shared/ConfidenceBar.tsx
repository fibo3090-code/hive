import { cn } from '@/lib/utils';

interface ConfidenceBarProps {
  value: number; // 0-100
  bars?: number;
  className?: string;
}

export function ConfidenceBar({ value, bars = 5, className }: ConfidenceBarProps) {
  const filledBars = Math.round((value / 100) * bars);
  return (
    <div className={cn('flex items-end gap-0.5', className)} title={`${value}%`}>
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className={cn(
            'w-1 rounded-sm transition-colors',
            i < filledBars ? 'bg-primary' : 'bg-muted',
          )}
          style={{ height: `${((i + 1) / bars) * 16}px` }}
        />
      ))}
    </div>
  );
}
