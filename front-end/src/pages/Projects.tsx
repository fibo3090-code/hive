import { SovereigntyBadge } from '@/components/shared/SovereigntyBadge';
import { Hexagon, Plus, Bot, ArrowRight } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useHiveData } from '@/api/queries/useHiveData';

export default function Projects() {
  const navigate = useNavigate();
  const { state, activeProject, setActiveProject } = useHiveData();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      {/* HIVE wordmark */}
      <div className="mb-12 text-center animate-fade-in">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Hexagon className="h-10 w-10 text-primary" fill="currentColor" />
          <h1 className="text-display-lg tracking-tight text-foreground">HIVE</h1>
        </div>
        <p className="text-muted-foreground text-lg">Autonomous Agent Orchestration Platform</p>
      </div>

      {/* Project cards grid */}
      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8 animate-fade-in" style={{ animationDelay: '100ms' }}>
        {state.projects.map((project) => {
          const budgetPct = Math.round((project.budget.used / project.budget.total) * 100);
          return (
            <button
              key={project.id}
              onClick={() => {
                void setActiveProject(project.id);
                navigate('/dashboard');
              }}
              className={cn(
                'group rounded-xl border border-border bg-card p-5 text-left hover:border-primary/40 hover:glow-amber transition-all',
                activeProject?.id === project.id && 'border-primary/40 glow-amber'
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{project.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{project.description}</p>
                </div>
                <SovereigntyBadge tier={project.sovereigntyTier} />
              </div>

              {/* Health bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-micro text-muted-foreground mb-1">
                  <span>Health</span>
                  <span className={cn('font-mono', project.healthScore >= 80 ? 'text-success' : project.healthScore >= 60 ? 'text-warning' : 'text-destructive')}>
                    {project.healthScore}%
                  </span>
                </div>
                <Progress value={project.healthScore} className="h-1" />
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between text-micro text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Bot className="h-3 w-3" />
                  <span>{project.agentCount} agents</span>
                </div>
                <span>${project.budget.used}/${project.budget.total}</span>
                <span>{project.lastActivity}</span>
              </div>

              {/* Budget bar */}
              <div className="mt-2">
                <Progress value={budgetPct} className="h-1" />
              </div>
            </button>
          );
        })}

        {/* New project card */}
        <button
          onClick={() => navigate('/onboarding')}
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-5 hover:border-primary/40 hover:bg-card transition-all min-h-[180px]"
        >
          <Plus className="h-8 w-8 text-muted-foreground mb-2" />
          <span className="text-sm text-muted-foreground">New Project</span>
        </button>
      </div>

      <p className="text-micro text-muted-foreground animate-fade-in" style={{ animationDelay: '200ms' }}>
        HIVE v6.0 — Select a project to enter, or create a new one
      </p>
    </div>
  );
}
