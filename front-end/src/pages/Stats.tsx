/**
 * Stats — pure analytics surface.
 *
 * Phase 5a of the redesign: Insights gets renamed to Stats and loses the
 * Tech Debt + Hive Mind tabs (they belong on the planning page now).
 * Today this is implemented as a thin lens over `Insights.tsx`: it
 * mounts the same component, then surfaces a banner explaining the
 * split. A follow-up will inline the analytics tabs here directly and
 * delete `Insights.tsx`.
 */
import { lazy, Suspense } from 'react';

const InsightsPage = lazy(() => import('./Insights'));

export default function Stats() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-2 text-xs text-info">
        Stats covers analytics only. Tech Debt and Hive Mind moved to{' '}
        <a className="underline underline-offset-2" href="/planning">
          Planning
        </a>
        .
      </div>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <InsightsPage />
      </Suspense>
    </div>
  );
}
