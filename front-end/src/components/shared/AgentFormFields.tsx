/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import { useToolCatalog, type ToolDescriptor } from '@/api/agents';

export interface AgentFormValue {
  name: string;
  role: string;
  model: ModelSelection | null;
  systemPrompt: string;
  /** Tool names this agent may use. Empty array = inherit the project default. */
  enabledTools: string[];
}

export const EMPTY_AGENT_FORM: AgentFormValue = {
  name: '',
  role: '',
  model: null,
  systemPrompt: '',
  enabledTools: [],
};

const DEFAULT_ROLE_PRESETS = [
  'Frontend',
  'Backend',
  'Testing',
  'Security',
  'Documentation',
  'DevOps',
  'Data',
  'Coordinator',
];

const CATEGORY_ORDER = ['filesystem', 'execution', 'research', 'memory', 'planning', 'git', 'coordination', 'other'];
const CATEGORY_LABELS: Record<string, string> = {
  filesystem: 'Filesystem',
  execution: 'Execution',
  research: 'Research',
  memory: 'Hive Mind',
  planning: 'Planning',
  git: 'Git',
  coordination: 'Coordination',
  other: 'Other',
};

interface Props {
  readonly value: AgentFormValue;
  readonly onChange: (next: AgentFormValue) => void;
  readonly idPrefix: string;
  /** Override the role quick-fill chips. */
  readonly rolePresets?: readonly string[];
  /** Help text under the system-prompt field (e.g. "leave blank to keep current"). */
  readonly systemPromptHint?: string;
  /** Hide the tool allowlist section (e.g. quick-spawn flows). */
  readonly hideTools?: boolean;
}

/**
 * The single agent-configuration form used by the spawn modal, the HiveGraph
 * config dialog, and the Forge agent builder. Keeping it in one place is what
 * makes "spawn an agent" and "edit an agent" consistent.
 */
export function AgentFormFields({ value, onChange, idPrefix, rolePresets = DEFAULT_ROLE_PRESETS, systemPromptHint, hideTools }: Props) {
  const toolsQuery = useToolCatalog();
  const tools: ToolDescriptor[] = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data]);
  const set = <K extends keyof AgentFormValue>(key: K, v: AgentFormValue[K]) => onChange({ ...value, [key]: v });

  const grouped = useMemo<Array<[string, ToolDescriptor[]]>>(() => {
    const byCat = new Map<string, ToolDescriptor[]>();
    for (const t of tools) {
      const arr = byCat.get(t.category) ?? [];
      arr.push(t);
      byCat.set(t.category, arr);
    }
    return [...byCat.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [tools]);
  const selected = new Set(value.enabledTools);
  const toggleTool = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set('enabledTools', [...next]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-name`} className="text-xs font-medium mb-1 block">Name</label>
          <input id={`${idPrefix}-name`} value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. API Architect"
            className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-role`} className="text-xs font-medium mb-1 block">Role</label>
          <input id={`${idPrefix}-role`} value={value.role} onChange={(e) => set('role', e.target.value)} placeholder="e.g. Frontend Architect"
            className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rolePresets.map((r) => (
          <button key={r} type="button" onClick={() => set('role', r)}
            className={cn('rounded-md border px-2 py-0.5 text-[11px] transition-colors',
              value.role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {r}
          </button>
        ))}
      </div>

      <div>
        <span className="text-xs font-medium mb-1 block">Model</span>
        <ModelPicker value={value.model} onChange={(m) => set('model', m)} />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-prompt`} className="text-xs font-medium mb-1 block">
          System prompt {systemPromptHint ? <span className="text-muted-foreground font-normal">({systemPromptHint})</span> : <span className="text-muted-foreground font-normal">(optional)</span>}
        </label>
        <textarea id={`${idPrefix}-prompt`} value={value.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} rows={5}
          placeholder="Extra instructions prepended to every turn for this agent…"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-mono resize-y" />
      </div>

      {!hideTools && (
        <div>
          <span className="text-xs font-medium mb-2 block">
            Allowed tools{' '}
            <span className="text-muted-foreground font-normal">
              ({selected.size === 0 ? 'inherit project default' : `${selected.size} selected`})
            </span>
          </span>
          {toolsQuery.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading tool catalog…</div>
          ) : tools.length === 0 ? (
            <div className="text-xs text-muted-foreground">No tools registered.</div>
          ) : (
            <div className="space-y-3">
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((tool) => {
                      const on = selected.has(tool.name);
                      return (
                        <button key={tool.name} type="button" onClick={() => toggleTool(tool.name)} aria-pressed={on}
                          title={tool.description}
                          className={cn('rounded-md border px-2 py-1 text-[11px] font-mono transition',
                            on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30')}>
                          {tool.name}{tool.sideEffects && <span className="ml-1 text-warning" title="Has side effects">⚠</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
