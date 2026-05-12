/**
 * Forge — unified fabrication surface.
 *
 * Phase 3 of the redesign: collapses Agent Forge + Modules into a single
 * tab with four sub-sections matching the four pillars the user
 * articulated:
 *
 *   1. Skills        — capability packages spliced into agent prompts
 *   2. Modules       — code synthesis (existing)
 *   3. Connectors    — HTTP APIs + MCP servers (encrypted credentials)
 *   4. Agents        — full custom agent builder (the existing AgentForge
 *                      content — kept here since it's the most mature
 *                      surface; refactor follows once Skills/Connectors
 *                      catch up)
 *
 * Each tab renders inline below; the `?tab=…` query param lets the
 * sidebar / command-palette deep-link, and old `/modules` and
 * `/agent-forge` routes redirect here with the matching tab pre-selected.
 */
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Plug, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSkills, useCreateSkill, useDeleteSkill } from '@/api/skills';
import { useConnectors } from '@/api/connectors';
import { Button } from '@/components/ui/button';
import { DisabledFeature } from '@/components/shared/DisabledFeature';
import { cn } from '@/lib/utils';

const ModulesPage = lazy(() => import('./Modules'));
const AgentForgePage = lazy(() => import('./AgentForge'));

type Tab = 'skills' | 'modules' | 'connectors' | 'agents';

const tabConfig: Array<{ id: Tab; label: string; icon: typeof Sparkles; hint: string }> = [
  { id: 'skills', label: 'Skills', icon: Wand2, hint: 'Reusable capability packages' },
  { id: 'modules', label: 'Modules', icon: Boxes, hint: 'Code synthesis' },
  { id: 'connectors', label: 'Connectors', icon: Plug, hint: 'APIs + MCP servers' },
  { id: 'agents', label: 'Agents', icon: Sparkles, hint: 'Custom agent builder' },
];

const validTabs = new Set<Tab>(['skills', 'modules', 'connectors', 'agents']);

export default function Forge() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && validTabs.has(requested) ? requested : 'skills';
  const setTab = useCallback(
    (next: Tab) => {
      const updated = new URLSearchParams(params);
      updated.set('tab', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Forge</h1>
        <p className="text-xs text-muted-foreground">
          Build the moving parts of your hive: skills, modules, connectors, and the
          agents that wire them together.
        </p>
      </header>

      <nav className="flex items-center gap-1 border-b border-border pb-1">
        {tabConfig.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === entry.id
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
            )}
            title={entry.hint}
          >
            <entry.icon className="h-3.5 w-3.5" />
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'skills' && <SkillsTab />}
      {tab === 'modules' && (
        <Suspense fallback={<div className="text-xs text-muted-foreground">Loading modules…</div>}>
          <ModulesPage />
        </Suspense>
      )}
      {tab === 'connectors' && <ConnectorsTab />}
      {tab === 'agents' && (
        <Suspense fallback={<div className="text-xs text-muted-foreground">Loading agents…</div>}>
          <AgentForgePage />
        </Suspense>
      )}
    </div>
  );
}

// ─── Skills tab ────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function SkillsTab() {
  const { activeProject } = useHiveData();
  const projectId = activeProject?.id ?? null;
  const skills = useSkills(projectId);
  const createSkill = useCreateSkill(projectId);
  const deleteSkill = useDeleteSkill(projectId);
  const items = skills.data ?? [];

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [promptFragment, setPromptFragment] = useState('');
  const slugTouched = useRef(false);

  const submit = async () => {
    if (!projectId) { toast.error('No active project.'); return; }
    if (!name.trim()) { toast.error('Name is required.'); return; }
    const finalSlug = (slug.trim() || slugify(name)) || 'skill';
    try {
      await createSkill.mutateAsync({
        projectId,
        slug: finalSlug,
        name: name.trim(),
        description: description.trim(),
        systemPromptFragment: promptFragment.trim() || undefined,
      });
      toast.success(`Skill "${name.trim()}" created.`);
      setOpen(false);
      setName(''); setSlug(''); setDescription(''); setPromptFragment(''); slugTouched.current = false;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create skill.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          A skill is a reusable package — system-prompt fragment + allowed tools + allowed paths — an agent can mount.
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>{open ? 'Cancel' : '+ New skill'}</Button>
      </div>

      {open && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="skill-name" className="text-[10px] font-medium uppercase text-muted-foreground">Name</label>
              <input id="skill-name" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched.current) setSlug(slugify(e.target.value)); }} className="mt-1 h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm" placeholder="e.g. Rust reviewer" />
            </div>
            <div>
              <label htmlFor="skill-slug" className="text-[10px] font-medium uppercase text-muted-foreground">Slug</label>
              <input id="skill-slug" value={slug} onChange={(e) => { slugTouched.current = true; setSlug(slugify(e.target.value)); }} className="mt-1 h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm font-mono" placeholder="rust-reviewer" />
            </div>
          </div>
          <div>
            <label htmlFor="skill-desc" className="text-[10px] font-medium uppercase text-muted-foreground">Description</label>
            <input id="skill-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm" placeholder="What this skill does" />
          </div>
          <div>
            <label htmlFor="skill-prompt" className="text-[10px] font-medium uppercase text-muted-foreground">System-prompt fragment <span className="font-normal lowercase text-muted-foreground">(optional)</span></label>
            <textarea id="skill-prompt" value={promptFragment} onChange={(e) => setPromptFragment(e.target.value)} className="mt-1 h-20 w-full rounded-md border border-border bg-surface-2 p-3 text-xs resize-none scrollbar-thin" placeholder="Instructions injected when an agent mounts this skill" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { void submit(); }} disabled={createSkill.isPending || !name.trim()}>
              {createSkill.isPending ? 'Creating…' : 'Create skill'}
            </Button>
          </div>
        </div>
      )}

      {!items.length ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No skills yet. Use “+ New skill” above to create one.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <li key={s.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{s.name}</h3>
                <code className="text-[10px] text-muted-foreground">{s.slug}</code>
              </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {s.description || 'No description.'}
          </p>
          {!!s.capabilitiesJson?.length && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {s.capabilitiesJson.map((c) => (
                <li
                  key={c}
                  className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {c}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex gap-2">
              {s.allowedToolsJson?.length > 0 && <span>{s.allowedToolsJson.length} tools</span>}
              {s.requiresConnectorIdsJson?.length > 0 && <span>· {s.requiresConnectorIdsJson.length} connector(s) needed</span>}
              {s.projectId === null && <span className="text-info">· global</span>}
            </span>
            <button
              onClick={() => {
                if (!window.confirm(`Delete skill "${s.name}"?`)) return;
                deleteSkill.mutate(s.id, {
                  onSuccess: () => toast.success('Skill deleted'),
                  onError: (e) => toast.error(e instanceof Error ? e.message : 'Delete failed'),
                });
              }}
              className="text-destructive hover:underline"
            >
              Delete
            </button>
          </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Connectors tab ────────────────────────────────────────────────────

function ConnectorsTab() {
  const { activeProject } = useHiveData();
  const connectors = useConnectors(activeProject?.id);
  const items = connectors.data ?? [];
  const grouped = useMemo(() => {
    const data = connectors.data ?? [];
    const apis = data.filter((c) => c.kind === 'api');
    const mcps = data.filter((c) => c.kind === 'mcp');
    return { apis, mcps };
  }, [connectors.data]);

  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <h3 className="text-sm font-semibold">No connectors yet</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect an external HTTP API (with encrypted credentials) or an MCP
          server. The auto-spawn pipeline reuses these before falling back to
          synthesis.
        </p>
        <div className="mt-4">
          <DisabledFeature kind="planned" reason="The connector editor (HTTP API + encrypted credentials, MCP server config) is not built yet.">
            <Button variant="outline">+ New connector</Button>
          </DisabledFeature>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.apis.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            HTTP APIs
          </h3>
          <ConnectorList items={grouped.apis} />
        </section>
      )}
      {grouped.mcps.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            MCP Servers
          </h3>
          <ConnectorList items={grouped.mcps} />
        </section>
      )}
    </div>
  );
}

function ConnectorList({ items }: { items: ReturnType<typeof useConnectors>['data'] }) {
  if (!items) return null;
  const statusColor: Record<string, string> = {
    connected: 'text-success',
    error: 'text-destructive',
    untested: 'text-muted-foreground',
  };
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{c.name}</span>
              <code className="text-[10px] text-muted-foreground">{c.slug}</code>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {c.baseUrl ?? 'no base url'} · {c.authKind}
              {c.maskedKey && <> · key {c.maskedKey}</>}
            </div>
          </div>
          <span className={cn('text-[11px] font-semibold', statusColor[c.status])}>
            {c.status}
          </span>
        </li>
      ))}
    </ul>
  );
}
