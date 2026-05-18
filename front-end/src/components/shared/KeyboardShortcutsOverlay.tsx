import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';

interface Shortcut {
  keys: string[];
  label: string;
  group: string;
}

const SHORTCUTS: Shortcut[] = [
  { group: 'Navigation', keys: ['⌘', 'K'], label: 'Open command palette' },
  { group: 'Navigation', keys: ['?'], label: 'Show this overlay' },
  { group: 'Navigation', keys: ['Esc'], label: 'Close dialogs / drawers' },
  { group: 'Chat', keys: ['⌘', '⏎'], label: 'Send message' },
  { group: 'Chat', keys: ['/help'], label: 'List slash commands' },
  { group: 'Chat', keys: ['/new'], label: 'Create thread' },
  { group: 'Chat', keys: ['/model'], label: 'Open model picker' },
  { group: 'Chat', keys: ['/compact'], label: 'Summarize old messages' },
  { group: 'Chat', keys: ['/clear'], label: 'Delete current thread' },
  { group: 'Hive Graph', keys: ['Drag'], label: 'Wire two agents (parent → child)' },
  { group: 'Hive Graph', keys: ['Right-click'], label: 'Agent context menu' },
];

/**
 * Global keyboard shortcuts cheatsheet. Press `?` anywhere outside an input
 * field to open. Single source of truth — update SHORTCUTS to keep it
 * honest with what the app actually supports.
 */
export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-primary" /> Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {groups.map((group) => (
            <section key={group}>
              <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
                {group}
              </div>
              <ul className="space-y-1.5">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.label} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{s.label}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="inline-flex items-center justify-center min-w-[24px] h-6 rounded border border-border bg-surface-2 px-1.5 text-micro font-mono text-muted-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-micro text-muted-foreground border-t border-border pt-3">
          Tip: most pages also surface a right-click context menu on primary entities.
        </p>
      </DialogContent>
    </Dialog>
  );
}
