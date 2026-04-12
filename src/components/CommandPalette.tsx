import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, FileText, GitCommit, Brain, Settings, LayoutDashboard, Network, MessageSquare, GitBranch, BarChart3, Boxes } from 'lucide-react';
import { mockAgents } from '@/data/mockData';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useWorkspace } from '@/context/WorkspaceContext';

type PaletteItem = {
  id: string;
  group: 'Commands' | 'Agents' | 'Files' | 'Commits' | 'Memory';
  label: string;
  meta?: string;
  preview: string;
  path: string;
  kind: 'navigation' | 'agent';
};

const items: PaletteItem[] = [
  { id: 'nav-dash', group: 'Commands', label: 'Go to Dashboard', preview: 'Open the summary view with alerts, tasks, commits, and budget status.', path: '/dashboard', kind: 'navigation' },
  { id: 'nav-graph', group: 'Commands', label: 'Go to Hive Graph', preview: 'Open the agent graph with status filters, lock overlay, and context menu actions.', path: '/hive-graph', kind: 'navigation' },
  { id: 'nav-chat', group: 'Commands', label: 'Go to Chat Central', preview: 'Open the coordination thread with mentions, attachments, and typing indicators.', path: '/chat', kind: 'navigation' },
  { id: 'nav-code', group: 'Commands', label: 'Go to Code & Versioning', preview: 'Inspect the file tree, PRs, diff review state, and active lock activity.', path: '/code', kind: 'navigation' },
  { id: 'nav-insights', group: 'Commands', label: 'Go to Insights', preview: 'Inspect replays, Hive Mind notes, technical debt, and evaluation metrics.', path: '/insights', kind: 'navigation' },
  { id: 'nav-spec', group: 'Commands', label: 'Go to Spec & Plan', preview: 'View sprint ordering, stories, and implementation status.', path: '/spec', kind: 'navigation' },
  { id: 'nav-modules', group: 'Commands', label: 'Go to Modules', preview: 'Browse installed and generated HCM modules.', path: '/modules', kind: 'navigation' },
  { id: 'nav-settings', group: 'Commands', label: 'Go to Settings', preview: 'Edit persisted preferences, appearance, integrations, and security.', path: '/settings', kind: 'navigation' },
  ...mockAgents.map((agent) => ({
    id: `agent-${agent.id}`,
    group: 'Agents' as const,
    label: agent.name,
    meta: agent.model,
    preview: `${agent.role} agent currently ${agent.status}. Current task: ${agent.currentTask}`,
    path: '/hive-graph',
    kind: 'agent' as const,
  })),
  { id: 'file-1', group: 'Files', label: 'src/components/Dashboard.tsx', meta: 'Modified', preview: 'Dashboard summary grid file with active project metrics and agent activity.', path: '/code', kind: 'navigation' },
  { id: 'file-2', group: 'Files', label: 'src/lib/auth.ts', meta: 'Locked', preview: 'Authentication helper currently targeted by PR #11 and lock overlay activity.', path: '/code', kind: 'navigation' },
  { id: 'commit-1', group: 'Commits', label: 'feat: implement dashboard summary tiles', meta: 'a3f2c1d', preview: 'Recent Frontend Architect commit related to dashboard tile wiring.', path: '/code', kind: 'navigation' },
  { id: 'memory-1', group: 'Memory', label: 'Authentication Flow — JWT + httpOnly', preview: 'Saved Hive Mind note describing the current auth flow and rotation policy.', path: '/insights', kind: 'navigation' },
];

const iconMap = {
  Commands: LayoutDashboard,
  Agents: Bot,
  Files: FileText,
  Commits: GitCommit,
  Memory: Brain,
} as const;

export function CommandPalette() {
  const navigate = useNavigate();
  const { setChatTargetAgentId, setGraphFocusAgentId, selectedCommandId, setSelectedCommandId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drawerAgent, setDrawerAgent] = useState<typeof mockAgents[number] | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.toLowerCase();
    return normalized === ''
      ? items
      : items.filter((item) => item.label.toLowerCase().includes(normalized) || item.preview.toLowerCase().includes(normalized) || item.meta?.toLowerCase().includes(normalized));
  }, [query]);

  const current = filtered[selectedIndex] ?? filtered[0] ?? null;
  const groups = [...new Set(filtered.map((item) => item.group))];

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

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const activate = (item: PaletteItem | null) => {
    if (!item) {
      return;
    }

    if (item.kind === 'agent') {
      const agentId = item.id.replace('agent-', '');
      const agent = mockAgents.find((candidate) => candidate.id === agentId) ?? null;
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
                      const index = filtered.findIndex((entry) => entry.id === item.id);
                      const Icon = group === 'Commands'
                        ? item.label.includes('Hive Graph') ? Network
                          : item.label.includes('Chat') ? MessageSquare
                          : item.label.includes('Code') ? GitBranch
                          : item.label.includes('Insights') ? BarChart3
                          : item.label.includes('Spec') ? FileText
                          : item.label.includes('Modules') ? Boxes
                          : item.label.includes('Settings') ? Settings
                          : LayoutDashboard
                        : iconMap[group];
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
                    <div className="font-medium text-foreground mb-1">Current selection</div>
                    <div>{selectedCommandId ?? current.id}</div>
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
