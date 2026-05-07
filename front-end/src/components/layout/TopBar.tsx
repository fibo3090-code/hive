import { Play, Users, Clock, Pause } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { NotificationDropdown } from './NotificationDropdown';
import { useHiveData } from '@/api/queries/useHiveData';
import { cn } from '@/lib/utils';

const routeNames: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/hive-graph': 'Hive Graph',
  '/chat': 'Chat Central',
  '/code': 'Code & Versioning',
  '/insights': 'Insights',
  '/stats': 'Stats',
  '/spec': 'Spec & Plan',
  '/planning': 'Planning',
  '/modules': 'Modules',
  '/forge': 'Forge',
  '/agent-forge': 'Agent Forge',
  '/session-history': 'Session History',
  '/projects': 'Projects',
  '/settings': 'Settings',
};

function resolveRouteName(pathname: string): string {
  if (routeNames[pathname]) return routeNames[pathname];
  // Match longest known prefix (e.g. /modules/:id → Modules)
  const match = Object.keys(routeNames)
    .filter((p) => pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return match ? routeNames[match] : 'HIVE';
}

export function TopBar() {
  const location = useLocation();
  const currentRoute = resolveRouteName(location.pathname);
  const { state, activeProject, toggleSession } = useHiveData();
  const { session, agents, healthScore } = state;

  const workingCount = agents.filter(a => a.status === 'working').length;
  const budgetPct = session.budgetTotal > 0
    ? Math.min(100, Math.round((session.budgetUsed / session.budgetTotal) * 100))
    : 0;
  const healthStrokeColor = healthScore <= 0
    ? 'hsl(var(--muted-foreground))'
    : healthScore < 50
      ? 'hsl(var(--warning))'
      : 'hsl(var(--success))';
  const healthTextClass = healthScore <= 0
    ? 'text-muted-foreground'
    : healthScore < 50
      ? 'text-warning'
      : 'text-success';

  return (
    <header className="flex h-10 items-center justify-between border-b border-border bg-surface-1 px-4">
      {/* Left: project + breadcrumb */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-foreground">{activeProject?.name ?? 'HIVE Dashboard'}</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="text-sm text-muted-foreground">{currentRoute}</span>
      </div>

      {/* Right: session info + controls */}
      <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto scrollbar-thin">
        {/* Session pill */}
        {session.isActive && (
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1">
            <Users className="h-3 w-3 text-primary" />
            <span className="text-caption font-mono text-primary">{workingCount}</span>
            <span className="h-3 w-px bg-primary/20" />
            <Clock className="h-3 w-3 text-primary" />
            <span className="text-caption font-mono text-primary">{session.elapsed}</span>
          </div>
        )}

        {/* Health score ring */}
        <div className="hidden sm:flex items-center gap-1.5" title={`Health score: ${healthScore}`}>
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20" aria-label="Health score">
            <circle cx="10" cy="10" r="8" fill="none" stroke="hsl(var(--muted))" strokeWidth="2" />
            <circle
              cx="10" cy="10" r="8" fill="none"
              stroke={healthStrokeColor}
              strokeWidth="2"
              strokeDasharray={`${Math.max(0, healthScore) * 0.502} ${50.2 - Math.max(0, healthScore) * 0.502}`}
              strokeLinecap="round"
            />
          </svg>
          <span className={cn('text-caption font-mono', healthTextClass)}>{healthScore}</span>
        </div>

        {/* Budget bar */}
        <div className="hidden md:flex items-center gap-2 w-28" title={`Budget: $${session.budgetUsed} of $${session.budgetTotal}`}>
          <span className="text-micro text-muted-foreground">${session.budgetUsed}</span>
          <Progress value={budgetPct} className="h-1.5 flex-1" />
          <span className="text-micro text-muted-foreground">${session.budgetTotal}</span>
        </div>

        {/* Notification dropdown */}
        <NotificationDropdown />

        {/* Session toggle button */}
        <Button
          size="sm"
          onClick={toggleSession}
          className={cn(
            'h-7 gap-1.5 text-xs transition-all',
            session.isActive
              ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          {session.isActive ? (
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
