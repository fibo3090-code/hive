import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Generic loading skeleton used as the route-level Suspense fallback. Each
 * lazy-loaded page renders this while its chunk downloads. The `variant`
 * lets the same component cover the major layout shapes without each
 * route inventing its own fallback.
 */
export function LoadingSkeleton({
  variant = 'page',
  className,
}: {
  readonly variant?: 'page' | 'compact' | 'inline';
  readonly className?: string;
}) {
  if (variant === 'inline') {
    return <Skeleton className={cn('h-4 w-24 rounded', className)} />;
  }
  if (variant === 'compact') {
    return (
      <div className={cn('p-4 space-y-3', className)}>
        <Skeleton className="h-6 w-1/3 rounded" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }
  // `page` — full-route fallback.
  return (
    <div className={cn('p-6 space-y-6', className)} aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-48 rounded" />
        <Skeleton className="h-7 w-24 rounded" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={`loading-stat-${i}`} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={`dashboard-stat-${i}`} className="h-24 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="col-span-2 h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
      <Skeleton className="h-40 rounded-lg" />
      <div className="grid grid-cols-3 gap-6">
        <Skeleton className="col-span-2 h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { readonly rows?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <Skeleton className="h-10 rounded-t-lg rounded-b-none" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={`table-row-${i}`} className="flex items-center gap-4 px-4 py-3 border-t border-border">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6, cols = 3 }: { readonly count?: number; readonly cols?: number }) {
  return (
    <div className={cn('grid gap-4', `grid-cols-${cols}`)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={`card-${i}`} className="h-40 rounded-lg" />
      ))}
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="w-48 border-r border-border py-2 space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={`sidebar-item-${i}`} className="flex items-center gap-2 px-4 py-2">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}
