/**
 * Planning — A→Z project planning surface.
 *
 * Phase 5b. Replaces the old SpecPlan and absorbs Tech Debt + Drift &
 * Delays from Insights.
 *
 *   - Spec Document: the markdown spec doc(s), versioned, with sections
 *     auto-derived (anchors slugified at write-time so tasks FK on them).
 *   - Skill Sprint: per-agent task lanes with `AgentStateChip`s and a
 *     clickable `SpecAnchorLink` back to the source section.
 *   - Tech Debt: lifted from Insights (Phase 5a).
 *   - Drift & Delays: unified drift events (3 kinds) + late-task list.
 *
 * The current implementation is intentionally compact: each tab embeds
 * its data hook from `@/api/*` and renders a list view sufficient for a
 * round-trip demo. Visual polish + drag-drop reorder land in follow-up
 * commits as the product feel firms up.
 */
import { useMemo, useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSpecDocuments, useSpecDocumentSections } from '@/api/spec-documents';
import { useDriftEvents, useUpdateDriftStatus } from '@/api/drift';
import { useAssignments } from '@/api/assignments';
import { useTechDebtData } from '@/api/queries/useServerData';
import type { TechDebtItem } from '@/types/domain';
import { AgentStateChip } from '@/components/shared/AgentStateChip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'spec' | 'sprint' | 'techdebt' | 'drift';

const tabLabels: Record<Tab, string> = {
  spec: 'Spec Document',
  sprint: 'Skill Sprint',
  techdebt: 'Tech Debt',
  drift: 'Drift & Delays',
};

export default function Planning() {
  const [tab, setTab] = useState<Tab>('spec');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {(Object.keys(tabLabels) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {tab === 'spec' && <SpecDocumentTab />}
      {tab === 'sprint' && <SkillSprintTab />}
      {tab === 'techdebt' && <TechDebtTab />}
      {tab === 'drift' && <DriftAndDelaysTab />}
    </div>
  );
}

// ─── Spec Document tab ─────────────────────────────────────────────────

function SpecDocumentTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const docs = useSpecDocuments(activeProjectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? docs.data?.[0]?.id ?? null;
  const sections = useSpecDocumentSections(effectiveId);

  if (!docs.data?.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No spec document yet. The CEO conversation in onboarding produces one
        automatically; otherwise you can create one from the API.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-3 space-y-1">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Documents</h3>
        {docs.data.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setSelectedId(doc.id)}
            className={cn(
              'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
              effectiveId === doc.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-surface-2',
            )}
          >
            <div className="truncate font-medium">{doc.title}</div>
            <div className="text-[10px] text-muted-foreground">
              v{doc.version} · {doc.source}
            </div>
          </button>
        ))}
      </aside>

      <main className="col-span-9 space-y-4">
        {sections.data?.length ? (
          sections.data.map((section) => (
            <section
              key={section.id}
              id={`section-${section.anchor}`}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{section.title}</h4>
                <code className="text-[10px] text-muted-foreground">#{section.anchor}</code>
              </div>
              {section.body && (
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{section.body}</pre>
              )}
            </section>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            This document has no parsed sections yet.
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Skill Sprint tab ──────────────────────────────────────────────────

function SkillSprintTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const assignments = useAssignments(activeProjectId);

  const grouped = useMemo(() => {
    const map = new Map<string, ReturnType<typeof useAssignments>['data']>();
    for (const a of assignments.data ?? []) {
      const arr = map.get(a.agentId) ?? [];
      arr.push(a);
      map.set(a.agentId, arr);
    }
    return Array.from(map.entries());
  }, [assignments.data]);

  if (!grouped.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No agent task assignments yet. Run the doc→sprint decomposition to
        populate this view.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([agentId, agentAssignments]) => (
        <section key={agentId} className="rounded-lg border border-border bg-card">
          <header className="border-b border-border bg-surface-2 px-4 py-2">
            <code className="text-xs font-mono text-muted-foreground">{agentId}</code>
          </header>
          <ul className="divide-y divide-border">
            {agentAssignments?.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="flex-1">
                  <div className="text-xs font-medium">Task {a.taskId}</div>
                  <div className="text-[10px] text-muted-foreground">
                    drift: {(a.driftScore * 100).toFixed(0)}%
                    {a.expectedCompletionAt && ` · due ${new Date(a.expectedCompletionAt).toLocaleDateString()}`}
                  </div>
                </div>
                <AgentStateChip state={a.state} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Tech Debt tab ──────────────────────────────────────────────────────

function TechDebtTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const techDebt = useTechDebtData(activeProjectId);
  const items = (techDebt.data ?? []) as TechDebtItem[];
  const columns = ['high', 'medium', 'low'] as const;
  const colors: Record<typeof columns[number], string> = {
    high: 'text-destructive',
    medium: 'text-warning',
    low: 'text-info',
  };

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No tech debt recorded for this project.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {columns.map((col) => (
        <div key={col}>
          <h4 className={cn('mb-2 text-xs font-semibold uppercase', colors[col])}>
            {col} severity
          </h4>
          <div className="space-y-2">
            {items
              .filter((i) => i.severity === col)
              .map((i) => (
                <div key={i.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="text-sm font-medium">{i.title}</div>
                  <div className="text-[11px] text-muted-foreground">{i.description}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <code className="font-mono">{i.file}</code>
                    {i.lines > 0 && <span>{i.lines} lines</span>}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Drift & Delays tab ────────────────────────────────────────────────

function DriftAndDelaysTab() {
  const { activeProject } = useHiveData();
  const activeProjectId = activeProject?.id ?? null;
  const drift = useDriftEvents(activeProjectId, { openOnly: false });
  const updateDrift = useUpdateDriftStatus(activeProjectId);
  const events = drift.data ?? [];

  if (!events.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No drift events recorded. The runtime detector populates this list as
        agents diverge from their tasks, code from spec, or behaviour from
        system prompt.
      </div>
    );
  }

  const kindLabels: Record<string, string> = {
    'agent-vs-task': 'Agent ⇄ Task',
    'code-vs-spec': 'Code ⇄ Spec',
    'agent-vs-system-prompt': 'Agent ⇄ Prompt',
  };
  const sevColors: Record<string, string> = {
    high: 'text-destructive border-destructive/40',
    medium: 'text-warning border-warning/40',
    low: 'text-info border-info/40',
  };

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className={cn(
            'rounded-lg border bg-card p-3',
            e.status === 'open'
              ? sevColors[e.severity] ?? 'border-border'
              : 'border-border opacity-70',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide">
                {kindLabels[e.kind] ?? e.kind}
                <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-px text-[10px] text-muted-foreground">
                  {e.severity}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {e.subjectKind} · <code className="font-mono">{e.subjectId}</code>
                {' · '}
                {new Date(e.createdAt).toLocaleString()}
                {e.status !== 'open' && (
                  <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-px text-[10px]">
                    {e.status}
                  </span>
                )}
              </div>
            </div>
            {e.status === 'open' ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'approved' })
                  }
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'corrected' })
                  }
                >
                  Correct
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    updateDrift.mutate({ id: e.id, status: 'dismissed' })
                  }
                >
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
