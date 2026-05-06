import { cn } from '@/lib/utils';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Network,
  MessageSquare,
  GitBranch,
  BarChart3,
  FileText,
  Settings,
  Hexagon,
  Sparkles,
  Clock,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useState } from 'react';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard' },
  { icon: Network, label: 'Hive Graph', path: '/hive-graph' },
  { icon: MessageSquare, label: 'Chat Central', path: '/chat' },
  { icon: GitBranch, label: 'Code & Versioning', path: '/code' },
  { icon: BarChart3, label: 'Stats', path: '/stats' },
  { icon: FileText, label: 'Planning', path: '/planning' },
  { icon: Sparkles, label: 'Forge', path: '/forge' },
  { icon: Clock, label: 'Session History', path: '/session-history' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export function HiveSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside className={cn(
      'flex h-screen flex-col border-r border-border bg-sidebar py-3 relative transition-all duration-200',
      expanded ? 'w-48' : 'w-12',
      'items-center',
    )}>
      {/* HIVE logo */}
      <button
        onClick={() => navigate('/')}
        className="mb-4 flex h-8 w-8 items-center justify-center rounded-md text-primary hover:glow-amber transition-all shrink-0"
      >
        <Hexagon className="h-6 w-6" fill="currentColor" />
      </button>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col items-center gap-1 w-full px-1.5">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path);
          return expanded ? (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'relative flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-xs transition-all',
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary" />
              )}
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          ) : (
            <Tooltip key={item.path} delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'relative flex h-9 w-9 items-center justify-center rounded-md transition-all',
                    isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent'
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary" />
                  )}
                  <item.icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="bg-surface-3 text-foreground border-border">
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Collapse/expand button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors shrink-0"
      >
        {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
      </button>

      {/* Session glow indicator */}
      <div className="absolute right-0 top-0 h-full w-px bg-gradient-to-b from-primary/0 via-primary/20 to-primary/0" />
    </aside>
  );
}
