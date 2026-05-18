import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHiveData } from '@/api/queries/useHiveData';
import { useSpawnRequests, useSpawnRequest, type AgentSpawnRequest, type SpawnStatus } from '@/api/spawn-requests';
import { EmptyState } from '@/components/shared/EmptyState';
import { JsonViewer } from '@/components/shared/JsonViewer';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Sparkles, Search, X, ChevronRight, Bot } from 'lucide-react';

const STAGE_ORDER: SpawnStatus[] = [
  'queued',
  'planning-needs',
  'matching-existing-mcp',
  'researching-api',
  'synthesizing-mcp',
  'composing-prompt',
  'awaiting-approval',
  'materializing-agent',
  'completed',
];

function stageColor(status: SpawnStatus, target: SpawnStatus): string {
  if (status === 'failed') return 'bg-destructive/30';
  if (status === 'cancelled') return 'bg-muted';
  const currentIdx = STAGE_ORDER.indexOf(status);
  const targetIdx = STAGE_ORDER.indexOf(target);
  if (currentIdx === -1 || targetIdx === -1) return 'bg-muted';
  if (targetIdx < currentIdx) return 'bg-success/60';
  if (targetIdx === currentIdx) return 'bg-primary animate-pulse';
  return 'bg-surface-3';
}

function statusBadge(status: SpawnStatus): { label: string; cls: string } {
  switch (status) {
    case 'completed':
      return { label: 'completed', cls: 'bg-success/10 text-success border-success/30' };
    case 'failed':
      return { label: 'failed', cls: 'bg-destructive/10 text-destructive border-destructive/30' };
    case 'cancelled':
      return { label: 'cancelled', cls: 'bg-muted text-muted-foreground border-border' };
    case 'awaiting-approval':
      return { label: 'awaiting approval', cls: 'bg-warning/10 text-warning border-warning/30' };
    default:
      return { label: status.replace(/-/g, ' '), cls: 'bg-primary/10 text-primary border-primary/30' };
  }
}

function StageTimeline({ status }: { readonly status: SpawnStatus }) {
  const isTerminal = status === 'failed' || status === 'cancelled';
  return (
    <div className="flex items-center gap-0.5" aria-label="Pipeline stages">
      {STAGE_ORDER.map((stage) => (
        <div
          key={stage}
          title={stage}
          className={cn('h-1.5 flex-1 rounded-sm', stageColor(status, stage))}
        />
      ))}
      {isTerminal && (
        <span className="ml-2 text-micro font-mono text-muted-foreground">{status}</span>
      )}
    </div>
  );
}

function SpawnRow({
  req,
  active,
  onClick,
  agentName,
}: {
  readonly req: AgentSpawnRequest;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly agentName: string | null;
}) {
  const badge = statusBadge(req.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md border bg-card px-3 py-2.5 transition-colors',
        active ? 'border-primary' : 'border-border hover:border-primary/40',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{req.requestedRole}</span>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-micro font-mono', badge.cls)}>
          {badge.label}
        </span>
      </div>
      <StageTimeline status={req.status} />
      <div className="flex items-center justify-between mt-2 text-micro text-muted-foreground font-mono">
        <span>
          {agentName ? `parent: ${agentName}` : 'no parent'} ·{' '}
          {req.requestedCapabilitiesJson?.length ?? 0} caps
        </span>
        <span>{new Date(req.updatedAt).toLocaleTimeString(undefined, { hour12: false })}</span>
      </div>
    </button>
  );
}

function SpawnDetail({ spawnId, onClose }: { readonly spawnId: string; readonly onClose: () => void }) {
  const { data: req, isLoading } = useSpawnRequest(spawnId);
  if (isLoading || !req) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  const badge = statusBadge(req.status);
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{req.requestedRole}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('rounded-full border px-2 py-0.5 text-micro font-mono', badge.cls)}>
              {badge.label}
            </span>
            <span className="text-micro font-mono text-muted-foreground">{req.id}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        <section>
          <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
            Pipeline
          </div>
          <ol className="space-y-1.5">
            {STAGE_ORDER.map((stage) => {
              const currentIdx = STAGE_ORDER.indexOf(req.status);
              const stageIdx = STAGE_ORDER.indexOf(stage);
              const done = stageIdx >= 0 && currentIdx >= 0 && stageIdx < currentIdx;
              const active = stage === req.status;
              return (
                <li key={stage} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      done && 'bg-success',
                      active && 'bg-primary animate-pulse',
                      !done && !active && 'bg-surface-3',
                    )}
                  />
                  <span
                    className={cn(
                      'font-mono',
                      done && 'text-muted-foreground line-through',
                      active && 'text-primary font-semibold',
                      !done && !active && 'text-muted-foreground/60',
                    )}
                  >
                    {stage}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {req.error && (
          <section className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="font-semibold mb-1">Error</div>
            {req.error}
          </section>
        )}

        <section>
          <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
            Requested capabilities
          </div>
          {req.requestedCapabilitiesJson.length === 0 ? (
            <div className="text-xs text-muted-foreground">None</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {req.requestedCapabilitiesJson.map((cap) => (
                <span
                  key={cap}
                  className="rounded-md bg-surface-2 border border-border px-2 py-0.5 text-micro font-mono"
                >
                  {cap}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <div className="text-micro text-muted-foreground">MCP strategy</div>
            <div className="font-mono">{req.mcpStrategy}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <div className="text-micro text-muted-foreground">Created</div>
            <div className="font-mono">{new Date(req.createdAt).toLocaleString()}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <div className="text-micro text-muted-foreground">Matched MCPs</div>
            <div className="font-mono">{req.matchedExistingMcpIdsJson.length}</div>
          </div>
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <div className="text-micro text-muted-foreground">Synthesized MCPs</div>
            <div className="font-mono">{req.synthesizedMcpIdsJson.length}</div>
          </div>
        </section>

        {req.generatedSystemPrompt && (
          <section>
            <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
              Generated system prompt
            </div>
            <pre className="rounded-md border border-border bg-surface-2 p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto scrollbar-thin">
              {req.generatedSystemPrompt}
            </pre>
          </section>
        )}

        {req.discoveredApiJson && (
          <section>
            <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
              Discovered API
            </div>
            <JsonViewer value={req.discoveredApiJson} label="discovered-api" previewChars={400} />
          </section>
        )}

        <section>
          <div className="text-micro uppercase font-semibold text-muted-foreground mb-2">
            Parent context
          </div>
          <JsonViewer value={req.contextJson} label="context" previewChars={300} />
        </section>
      </div>
    </div>
  );
}

export default function SpawnRequests() {
  const navigate = useNavigate();
  const { state, activeProject } = useHiveData();
  const projectId = activeProject?.id ?? null;
  const { data, isLoading } = useSpawnRequests(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SpawnStatus | null>(null);

  const agentName = useMemo(() => {
    const map = new Map(state.agents.map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? map.get(id) ?? null : null);
  }, [state.agents]);

  const requests = useMemo(() => {
    const list = data ?? [];
    return list
      .filter((r) => !statusFilter || r.status === statusFilter)
      .filter((r) => !search || r.requestedRole.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [data, search, statusFilter]);

  const statuses: SpawnStatus[] = ['queued', 'awaiting-approval', 'completed', 'failed'];

  if (!projectId) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Sparkles}
          title="No project selected"
          description="Pick a project from the workspace switcher to view its agent spawn pipeline."
          action={{ label: 'Open projects', onClick: () => navigate('/') }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col w-[420px] shrink-0 border-r border-border bg-surface-2 overflow-hidden">
        <div className="border-b border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">Agent Spawn Requests</h1>
          </div>
          <p className="text-micro text-muted-foreground">
            Live state machine for the auto-spawn pipeline. Each row updates as the runtime walks
            through planning → MCP matching → synthesis → prompt composition → materialization.
          </p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by role…"
              className="w-full h-7 rounded-md border border-border bg-card pl-7 pr-2 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {statuses.map((s) => {
              const b = statusBadge(s);
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(active ? null : s)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-micro font-mono',
                    active ? b.cls : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
          {isLoading && (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          )}
          {!isLoading && requests.length === 0 && (
            <EmptyState
              icon={Sparkles}
              title="No spawn requests"
              description="When a parent agent (or a Hive operator) requests a new agent, it appears here with its full pipeline state."
            />
          )}
          {!isLoading &&
            requests.map((req) => (
              <SpawnRow
                key={req.id}
                req={req}
                active={selected === req.id}
                agentName={agentName(req.parentAgentId)}
                onClick={() => setSelected(req.id)}
              />
            ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 bg-background">
        {selected ? (
          <SpawnDetail spawnId={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              Select a request <ChevronRight className="h-3 w-3" /> see live pipeline detail
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
