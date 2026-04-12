import { useState } from 'react';
import { Bell, Check, X, AlertTriangle, XCircle, AlertCircle, Info, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export interface Notification {
  id: string;
  type: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  message: string;
  time: string;
  read: boolean;
  actionable?: boolean;
  actionLabel?: string;
}

const initialNotifications: Notification[] = [
  { id: 'n1', type: 'critical', title: 'Budget threshold reached', message: 'Project budget at 89% — 3 agents throttled', time: '2 min ago', read: false, actionable: true, actionLabel: 'Extend Budget' },
  { id: 'n2', type: 'high', title: 'Agent loop detected', message: 'Doc Writer repeated same action 4 times', time: '8 min ago', read: false, actionable: true, actionLabel: 'Intervene' },
  { id: 'n3', type: 'medium', title: 'Spec drift in §4.2', message: 'Implementation diverged from PRD', time: '23 min ago', read: false, actionable: true, actionLabel: 'Review' },
  { id: 'n4', type: 'info', title: 'Eval batch complete', message: 'QA Sentinel — 94% pass rate', time: '45 min ago', read: false },
  { id: 'n5', type: 'info', title: 'PR #11 ready', message: 'Backend Engineer: auth middleware', time: '1 hr ago', read: true },
  { id: 'n6', type: 'medium', title: 'Test coverage dropped', message: 'Coverage fell below 70% threshold', time: '1.5 hr ago', read: true },
  { id: 'n7', type: 'high', title: 'Security scan warning', message: 'Potential credential leak in config.ts', time: '2 hr ago', read: true, actionable: true, actionLabel: 'Review' },
];

const typeConfig = {
  critical: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10', dot: 'bg-destructive' },
  high: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10', dot: 'bg-warning' },
  medium: { icon: AlertCircle, color: 'text-info', bg: 'bg-info/10', dot: 'bg-info' },
  info: { icon: Info, color: 'text-muted-foreground', bg: 'bg-muted/10', dot: 'bg-muted-foreground' },
};

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const dismiss = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const handleAction = (id: string) => {
    markAsRead(id);
    // In a real app this would trigger the action
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 z-50 w-[380px] rounded-lg border border-border bg-card shadow-xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">{unreadCount} new</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-micro text-primary hover:underline">
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-[400px] overflow-auto scrollbar-thin divide-y divide-border">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">All caught up!</p>
                  </div>
                ) : (
                  notifications.map(n => {
                    const config = typeConfig[n.type];
                    const Icon = config.icon;
                    return (
                      <motion.div
                        key={n.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        className={cn(
                          'flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50 group',
                          !n.read && 'bg-surface-2/30'
                        )}
                      >
                        <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', config.bg)}>
                          <Icon className={cn('h-3.5 w-3.5', config.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn('text-xs font-medium leading-tight', !n.read ? 'text-foreground' : 'text-muted-foreground')}>{n.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              {!n.read && <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />}
                              <button onClick={() => dismiss(n.id)} className="text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <p className="text-micro text-muted-foreground mt-0.5 truncate">{n.message}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-micro text-muted-foreground/70 flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />{n.time}
                            </span>
                            {n.actionable && (
                              <button onClick={() => handleAction(n.id)} className="text-micro font-medium text-primary hover:underline">
                                {n.actionLabel}
                              </button>
                            )}
                            {!n.read && (
                              <button onClick={() => markAsRead(n.id)} className="text-micro text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                                <Check className="h-2.5 w-2.5" /> Read
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border px-4 py-2 text-center">
                <button onClick={() => setOpen(false)} className="text-micro text-muted-foreground hover:text-foreground">
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
