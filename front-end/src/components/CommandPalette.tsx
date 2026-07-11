import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Settings, LayoutDashboard, Network, MessageSquare, GitBranch, BarChart3, Boxes, ClipboardList, Hammer, History, Plus, Wand2 } from 'lucide-react';
import { useHiveData } from '@/api/queries/useHiveData';
import type { Agent } from '@/types/domain';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useWorkspace } from '@/context/WorkspaceContext';

type LucideIconComponent = typeof LayoutDashboard;

type PaletteItem = {
  id: string;
  group: 'Navigate' | 'Actions' | 'Agents';
  label: string;
  meta?: string;
  preview: string;
  path: string;
  kind: 'navigation' | 'agent';
  icon: LucideIconComponent;
};

const commandItems: PaletteItem[] = [
  { id: 'nav-dash', group: 'Navigate', label: 'Go to Dashboard', preview: 'Summary view: alerts, tasks, commits, budget status.', path: '/dashboard', kind: 'navigation', icon: LayoutDashboard },
  { id: 'nav-graph', group: 'Navigate', label: 'Go to Hive Graph', preview: 'Agent graph with status filters and the agent detail drawer.', path: '/hive-graph', kind: 'navigation', icon: Network },
  { id: 'nav-chat', group: 'Navigate', label: 'Go to Chat Central', preview: 'Coordination threads with mentions, attachments, and slash commands.', path: '/chat', kind: 'navigation', icon: MessageSquare },
  { id: 'nav-code', group: 'Navigate', label: 'Go to Code & Versioning', preview: 'Working tree, file viewer, commit / discard against the project git repo.', path: '/code', kind: 'navigation', icon: GitBranch },
  { id: 'nav-stats', group: 'Navigate', label: 'Go to Stats', preview: 'Agent / project metrics, runtime feed, eval leaderboard.', path: '/stats', kind: 'navigation', icon: BarChart3 },
  { id: 'nav-planning', group: 'Navigate', label: 'Go to Planning', preview: 'Spec docs, sprint plan, tech-debt board, Hive Mind notes, drift.', path: '/planning', kind: 'navigation', icon: ClipboardList },
  { id: 'nav-forge', group: 'Navigate', label: 'Go to Forge', preview: 'Skills, Modules, Connectors, and the custom agent builder.', path: '/forge', kind: 'navigation', icon: Hammer },
  { id: 'nav-spawn', group: 'Navigate', label: 'Go to Spawn Requests', preview: 'Live agent auto-spawn pipeline: planning, MCP matching, synthesis, materialization.', path: '/spawn-requests', kind: 'navigation', icon: Wand2 },
  { id: 'nav-modules', group: 'Navigate', label: 'Go to Modules', preview: 'Browse installed and generated HCM modules.', path: '/forge?tab=modules', kind: 'navigation', icon: Boxes },
  { id: 'nav-history', group: 'Navigate', label: 'Go to Session History', preview: 'Past sessions and their outcomes.', path: '/session-history', kind: 'navigation', icon: History },
  { id: 'nav-settings', group: 'Navigate', label: 'Go to Settings', preview: 'LLM providers, GitHub sync, tools & sandbox, and other preferences.', path: '/settings', kind: 'navigation', icon: Settings },
  { id: 'act-new-project', group: 'Actions', label: 'New project (onboarding)', preview: 'Start the onboarding flow to create a new project.', path: '/onboarding', kind: 'navigation', icon: Plus },
  { id: 'act-new-thread', group: 'Actions', label: 'New chat thread', preview: 'Open Chat Central — use the "+" next to an agent or type /new.', path: '/chat', kind: 'navigation', icon: MessageSquare },
  { id: 'act-llm-settings', group: 'Actions', label: 'Connect an LLM provider', preview: 'Jump to Settings → LLM Providers to add or test API keys.', path: '/settings', kind: 'navigation', icon: Settings },
];

/**
 * Subsequence fuzzy match: every char of `q` must appear in `text` in order.
 * Returns a score (higher = better, contiguous + word-start matches win); -1 = no match.
 */
function fuzzyScore(query: string, text: string): number {
  if (query === '') return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti === prevMatch + 1 ? 5 : 1; // reward contiguous runs
      if (ti === 0 || ' /-_.'.includes(t[ti - 1])) score += 3; // reward word starts
      prevMatch = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1;
  return score - text.length * 0.01; // mild bias toward shorter strings
}

function bestFuzzyScore(query: string, ...fields: Array<string | undefined>): number {
  let best = -1;
  for (const f of fields) {
    if (f === undefined) continue;
    best = Math.max(best, fuzzyScore(query, f));
  }
  return best;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { setChatTargetAgentId, setGraphFocusAgentId, setSelectedCommandId } = useWorkspace();
  const { state } = useHiveData();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drawerAgent, setDrawerAgent] = useState<Agent | null>(null);

  const items = useMemo<PaletteItem[]>(() => [
    ...commandItems,
    ...state.agents.map((agent) => ({
      id: `agent-${agent.id}`,
      group: 'Agents' as const,
      label: agent.name,
      meta: agent.model,
      preview: `${agent.role} agent currently ${agent.status}. Current task: ${agent.currentTask ?? 'No active task'}`,
      path: '/hive-graph',
      kind: 'agent' as const,
      icon: Bot,
    })),
  ], [state.agents]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q === '') return items;
    return items
      .map((item) => ({ item, score: bestFuzzyScore(q, item.label, item.meta, item.preview) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [items, query]);

  const current = filtered[selectedIndex] ?? filtered[0] ?? null;
  const groups = [...new Set(filtered.map((item) => item.group))];
  // C423: the per-item findIndex inside the render loop was O(n²) per
  // keystroke; one pass builds the id → flat-index map instead.
  const indexById = useMemo(() => new Map(filtered.map((item, i) => [item.id, i])), [filtered]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedCommandId(current?.id ?? null);
  }, [current, open, setSelectedCommandId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setSelectedIndex(0);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    globalThis.addEventListener('keydown', handler);
    return () => globalThis.removeEventListener('keydown', handler);
  }, []);

  const activate = (item: PaletteItem | null) => {
    if (!item) {
      return;
    }

    if (item.kind === 'agent') {
      const agentId = item.id.replace('agent-', '');
      const agent = state.agents.find((candidate) => candidate.id === agentId) ?? null;
      setDrawerAgent(agent);
      return;
    }

    setOpen(false);
    navigate(item.path);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <div className="grid grid-cols-[1.1fr_0.9fr] min-h-[420px]">
            <Command className="border-r border-border">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setSelectedIndex((value) => Math.min(value + 1, filtered.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSelectedIndex((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    activate(current);
                  }
                }}
                placeholder="Search commands, agents, files..."
              />
              <CommandList className="max-h-[420px]">
                {filtered.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
                {groups.map((group) => (
                  <CommandGroup key={group} heading={group}>
                    {filtered.filter((item) => item.group === group).map((item) => {
                      const index = indexById.get(item.id) ?? -1;
                      const Icon = item.icon;
                      return (
                        <CommandItem
                          key={item.id}
                          value={item.label}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onSelect={() => activate(item)}
                          className={cn('flex items-center gap-3', index === selectedIndex && 'bg-accent text-accent-foreground')}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.meta && <span className="text-micro font-mono text-muted-foreground">{item.meta}</span>}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>

            <div className="p-6 flex flex-col">
              <div className="text-micro uppercase text-muted-foreground font-semibold mb-2">Preview</div>
              {current ? (
                <>
                  <div className="text-lg font-semibold">{current.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{current.group}</div>
                  <p className="text-sm text-muted-foreground mt-4 leading-relaxed">{current.preview}</p>
                  {current.meta && <div className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-xs font-mono text-muted-foreground">{current.meta}</div>}
                  <div className="mt-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
                    {current.kind === 'agent'
                      ? 'Press Enter to open the agent detail drawer.'
                      : <>Press Enter to go to <span className="font-mono text-foreground">{current.path}</span>.</>}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Pick a command to preview its destination and context.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Drawer open={Boolean(drawerAgent)} onOpenChange={(value) => !value && setDrawerAgent(null)}>
        <DrawerContent className="mx-auto max-w-xl">
          {drawerAgent && (
            <>
              <DrawerHeader>
                <DrawerTitle>{drawerAgent.name}</DrawerTitle>
                <DrawerDescription>{drawerAgent.role} • {drawerAgent.model}</DrawerDescription>
              </DrawerHeader>
              <div className="px-4 space-y-3 text-sm">
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground mb-1">Current task</div>
                  <div>{drawerAgent.currentTask}</div>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="text-xs text-muted-foreground mb-1">Status</div>
                  <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> {drawerAgent.status}</div>
                </div>
              </div>
              <DrawerFooter>
                <button
                  onClick={() => {
                    setChatTargetAgentId(drawerAgent.id);
                    setDrawerAgent(null);
                    setOpen(false);
                    navigate('/chat');
                  }}
                  className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  Message Agent
                </button>
                <button
                  onClick={() => {
                    setGraphFocusAgentId(drawerAgent.id);
                    setDrawerAgent(null);
                    setOpen(false);
                    navigate('/hive-graph');
                  }}
                  className="rounded-md border border-border px-3 py-2 text-sm"
                >
                  Open in Hive Graph
                </button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
