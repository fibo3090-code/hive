import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, Info, XCircle, X, ChevronDown, ChevronRight } from 'lucide-react';
import type { AlertItem } from '@/types/domain';

const severityConfig = {
  critical: { icon: XCircle, border: 'border-l-destructive', bg: 'bg-destructive/5', text: 'text-destructive' },
  high: { icon: AlertTriangle, border: 'border-l-warning', bg: 'bg-warning/5', text: 'text-warning' },
  medium: { icon: AlertCircle, border: 'border-l-info', bg: 'bg-info/5', text: 'text-info' },
  info: { icon: Info, border: 'border-l-muted-foreground', bg: 'bg-muted/5', text: 'text-muted-foreground' },
};

interface AlertBannersProps {
  readonly alerts: AlertItem[];
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onDismiss: (id: string) => void;
  readonly onAction: (alert: AlertItem) => void;
}

export function AlertBanners({ alerts, expanded, onToggleExpand, onDismiss, onAction }: AlertBannersProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      <button onClick={onToggleExpand} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {alerts.length} Alerts
      </button>
      <AnimatePresence>
        {expanded && alerts.map((alert) => {
          const config = severityConfig[alert.severity as keyof typeof severityConfig] ?? severityConfig.info;
          const Icon = config.icon;
          return (
            <motion.div key={alert.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className={cn('flex items-center gap-3 rounded-md border-l-4 px-4 py-2.5', config.border, config.bg)}>
              <Icon className={cn('h-4 w-4 shrink-0', config.text)} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{alert.title}</span>
                <span className="text-xs text-muted-foreground ml-2">{alert.message}</span>
              </div>
              <span className="text-micro text-muted-foreground">{alert.timestamp}</span>
              {alert.actionLabel && (
                <button onClick={() => onAction(alert)} className="text-xs font-medium text-primary hover:underline">{alert.actionLabel}</button>
              )}
              <button onClick={() => onDismiss(alert.id)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
