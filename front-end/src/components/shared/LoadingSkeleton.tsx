import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

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
