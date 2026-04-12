import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Command, Bot, FileText, GitCommit, Brain, Settings, LayoutDashboard, Network, MessageSquare, GitBranch, BarChart3, Boxes } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockAgents } from '@/data/mockData';
import { motion, AnimatePresence } from 'framer-motion';

const commands = [
  { id: 'nav-dash', group: 'Commands', label: 'Go to Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'nav-graph', group: 'Commands', label: 'Go to Hive Graph', icon: Network, path: '/hive-graph' },
  { id: 'nav-chat', group: 'Commands', label: 'Go to Chat Central', icon: MessageSquare, path: '/chat' },
  { id: 'nav-code', group: 'Commands', label: 'Go to Code & Versioning', icon: GitBranch, path: '/code' },
  { id: 'nav-insights', group: 'Commands', label: 'Go to Insights', icon: BarChart3, path: '/insights' },
  { id: 'nav-spec', group: 'Commands', label: 'Go to Spec & Plan', icon: FileText, path: '/spec' },
  { id: 'nav-modules', group: 'Commands', label: 'Go to Modules', icon: Boxes, path: '/modules' },
  { id: 'nav-settings', group: 'Commands', label: 'Go to Settings', icon: Settings, path: '/settings' },
  ...mockAgents.map(a => ({ id: `agent-${a.id}`, group: 'Agents', label: a.name, icon: Bot, path: '/hive-graph', meta: a.model })),
  { id: 'file-1', group: 'Files', label: 'src/components/Dashboard.tsx', icon: FileText, path: '/code' },
  { id: 'file-2', group: 'Files', label: 'src/lib/auth.ts', icon: FileText, path: '/code' },
  { id: 'file-3', group: 'Files', label: 'src/lib/api.ts', icon: FileText, path: '/code' },
  { id: 'commit-1', group: 'Commits', label: 'feat: implement dashboard summary tiles', icon: GitCommit, path: '/code', meta: 'a3f2c1d' },
  { id: 'commit-2', group: 'Commits', label: 'feat: add auth middleware', icon: GitCommit, path: '/code', meta: 'b8e4f2a' },
  { id: 'memory-1', group: 'Memory', label: 'Authentication Flow — JWT + httpOnly', icon: Brain, path: '/insights' },
  { id: 'memory-2', group: 'Memory', label: 'Error Handling Pattern — Result<T, E>', icon: Brain, path: '/insights' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  const filtered = query === '' ? commands : commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()));
  const groups = [...new Set(filtered.map(c => c.group))];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); setQuery(''); setSelectedIndex(0); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSelect = useCallback((item: typeof commands[0]) => {
    setOpen(false);
    navigate(item.path);
  }, [navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIndex]) { handleSelect(filtered[selectedIndex]); }
  };

  useEffect(() => { setSelectedIndex(0); }, [query]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown} className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none" placeholder="Search commands, agents, files..." />
            <kbd className="rounded bg-surface-2 px-1.5 py-0.5 text-micro font-mono text-muted-foreground">ESC</kbd>
          </div>
          <div className="max-h-[400px] overflow-auto scrollbar-thin py-2">
            {groups.map(group => (
              <div key={group}>
                <div className="px-4 py-1.5 text-micro font-semibold text-muted-foreground uppercase">{group}</div>
                {filtered.filter(c => c.group === group).map(item => {
                  flatIndex++;
                  const idx = flatIndex;
                  const Icon = item.icon;
                  return (
                    <button key={item.id} onClick={() => handleSelect(item)} onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn('flex items-center gap-3 w-full px-4 py-2 text-sm transition-colors', idx === selectedIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-surface-2')}>
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {'meta' in item && item.meta && <span className="text-micro font-mono text-muted-foreground">{item.meta}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results found</div>}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
