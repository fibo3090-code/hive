import { Play, Users, Clock, Pause, Square } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { NotificationDropdown } from './NotificationDropdown';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const routeNames: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/hive-graph': 'Hive Graph',
  '/chat': 'Chat Central',
  '/code': 'Code & Versioning',
  '/insights': 'Insights',
  '/spec': 'Spec & Plan',
  '/modules': 'Modules',
  '/settings': 'Settings',
};

export function TopBar() {
  const location = useLocation();
  const currentRoute = routeNames[location.pathname] || 'HIVE';
  const [sessionActive, setSessionActive] = useState(true);
  const [elapsed, setElapsed] = useState('01:23:45');
  const [budgetUsed] = useState(142);
  const [budgetTotal] = useState(200);
  const budgetPct = Math.round((budgetUsed / budgetTotal) * 100);

  return (
    <header className="flex h-10 items-center justify-between border-b border-border bg-surface-1 px-4">
      {/* Left: project + breadcrumb */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-foreground">HIVE Dashboard</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm text-muted-foreground">{currentRoute}</span>
      </div>

      {/* Right: session info + controls */}
      <div className="flex items-center gap-4">
        {/* Session pill */}
        {sessionActive && (
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1">
            <Users className="h-3 w-3 text-primary" />
            <span className="text-caption font-mono text-primary">4</span>
            <span className="h-3 w-px bg-primary/20" />
            <Clock className="h-3 w-3 text-primary" />
            <span className="text-caption font-mono text-primary">{elapsed}</span>
          </div>
        )}

        {/* Health score ring */}
        <div className="flex items-center gap-1.5">
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="none" stroke="hsl(var(--muted))" strokeWidth="2" />
            <circle
              cx="10" cy="10" r="8" fill="none"
              stroke="hsl(var(--success))"
              strokeWidth="2"
              strokeDasharray={`${87 * 0.502} ${50.2 - 87 * 0.502}`}
              strokeLinecap="round"
            />
          </svg>
          <span className="text-caption font-mono text-success">87</span>
        </div>

        {/* Budget bar */}
        <div className="flex items-center gap-2 w-28">
          <span className="text-micro text-muted-foreground">${budgetUsed}</span>
          <Progress value={budgetPct} className="h-1.5 flex-1" />
          <span className="text-micro text-muted-foreground">${budgetTotal}</span>
        </div>

        {/* Notification dropdown */}
        <NotificationDropdown />

        {/* Session toggle button */}
        <Button
          size="sm"
          onClick={() => setSessionActive(!sessionActive)}
          className={cn(
            'h-7 gap-1.5 text-xs transition-all',
            sessionActive
              ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          {sessionActive ? (
            <>
              <Pause className="h-3 w-3" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Start Session
            </>
          )}
        </Button>
      </div>
    </header>
  );
}
