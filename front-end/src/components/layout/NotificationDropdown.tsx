import { Bell, Check, X, AlertTriangle, XCircle, AlertCircle, Info, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';

const typeConfig = {
  critical: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10', dot: 'bg-destructive' },
  high: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10', dot: 'bg-warning' },
  medium: { icon: AlertCircle, color: 'text-info', bg: 'bg-info/10', dot: 'bg-info' },
  info: { icon: Info, color: 'text-muted-foreground', bg: 'bg-muted/10', dot: 'bg-muted-foreground' },
};

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const { state, markNotificationRead, markAllNotificationsRead, dismissNotification } = useHiveData();
  const { notifications } = state;
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleAction = (id: string) => {
    markNotificationRead(id);
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
            <div
              className="fixed inset-0 z-40"
              role="button"
              tabIndex={0}
              onClick={() => setOpen(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(false); }}
              aria-label="Close notifications"
            />

            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 z-50 w-[380px] rounded-lg border border-border bg-card shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Notifications</h3>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">{unreadCount} new</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button onClick={markAllNotificationsRead} className="text-micro text-primary hover:underline">
                    Mark all read
                  </button>
                )}
              </div>

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
                            <p className={cn('text-xs font-medium leading-tight', n.read ? 'text-muted-foreground' : 'text-foreground')}>{n.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              {!n.read && <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />}
                              <button onClick={() => dismissNotification(n.id)} className="text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
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
                              <button onClick={() => markNotificationRead(n.id)} className="text-micro text-muted-foreground hover:text-foreground flex items-center gap-0.5">
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
