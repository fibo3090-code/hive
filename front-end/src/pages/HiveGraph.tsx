import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHiveData } from '@/api/queries/useHiveData';
import { useAgentLineage, useAgentMessages, useDispatchAgentTask, usePauseAgent, useResumeAgent, useTerminateAgent } from '@/api/agents';
import type { Agent } from '@/types/domain';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import { Network, Search, Lock, Plus, LayoutGrid, X, MessageSquare, Pause, Play, Settings, Trash2, SendHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useWorkspace } from '@/context/WorkspaceContext';
import { AgentSpawnModal } from '@/components/modals/AgentSpawnModal';
import { toast } from 'sonner';

const lockedAgents = new Set<string>();
const nodeTypes = { agentNode: AgentNode };

type AgentNodeData = {
  agent: Agent;
  isRoot: boolean;
  highlighted: boolean;
  dimmed: boolean;
  locked: boolean;
  showLock: boolean;
  onMessage: (agentId: string) => void;
  onOpen: (agentId: string) => void;
  onTogglePause: (agent: Agent) => void;
};

function buildGraph(agents: Agent[]): { nodes: Node[]; edges: Edge[] } {
  if (agents.length === 0) {
    return { nodes: [], edges: [] };
  }

  const root = agents[0];
  const children = agents.slice(1);
  const spacing = 220;
  const startX = -((children.length - 1) * spacing) / 2;
  return {
    nodes: [
      { id: root.id, type: 'agentNode', position: { x: 0, y: 0 }, data: { agent: root, isRoot: true } },
      ...children.map((agent, index) => ({
        id: agent.id,
        type: 'agentNode',
        position: { x: startX + index * spacing, y: 180 },
        data: { agent, isRoot: false },
      })),
    ],
    edges: children.map((agent) => ({
      id: `edge-${root.id}-${agent.id}`,
      source: root.id,
      target: agent.id,
      animated: agent.status === 'working',
      style: { stroke: 'hsl(var(--border))' },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--border))' },
    })),
  };
}

function EmptyGraphState() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-dashed border-border bg-card/60 p-8 text-center">
        <h3 className="text-sm font-semibold mb-1">No agents in this project yet</h3>
        <p className="text-xs text-muted-foreground">
          This project does not have any active agents to render in the graph yet. Create one from Agent Forge or switch to a seeded project.
        </p>
      </div>
    </div>
  );
}

function AgentNode({ data }: { readonly data: AgentNodeData }) {
  const agent = data.agent;
  const qualityScore = agent.qualityScore ?? 0;
  const borderColorIfPaused = agent.status === 'paused' ? 'border-warning/40' : 'border-border';
  const borderColorIfBlocked = agent.status === 'blocked' ? 'border-destructive/40' : borderColorIfPaused;
  const borderColor = agent.status === 'working' ? 'border-success/40' : borderColorIfBlocked;
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div className={cn('rounded-lg border bg-card px-4 py-3 min-w-[170px] max-w-[210px] cursor-pointer hover:border-primary/40 transition-all relative', borderColor, data.isRoot && 'glow-amber border-primary/30', data.highlighted && 'ring-2 ring-primary/40', data.dimmed && 'opacity-35')}>
          <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2 !border-0" />
          <div className="flex items-center gap-2 mb-1">
            <StatusDot status={agent.status} size="sm" />
            <span className="text-xs font-semibold truncate">{agent.name}</span>
          </div>
          <span className="text-micro text-muted-foreground font-mono block mb-1">{agent.model}</span>
          <p className="text-micro text-muted-foreground truncate mb-1.5">{agent.currentTask}</p>
          <ConfidenceBar value={qualityScore} bars={5} />
          {data.showLock && data.locked && <div className="absolute top-2 right-2 rounded-full bg-info/10 px-2 py-0.5 text-[10px] text-info">lock</div>}
          <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2 !border-0" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => data.onMessage(agent.id)}>Message agent</ContextMenuItem>
        <ContextMenuItem onClick={() => data.onOpen(agent.id)}>Open details</ContextMenuItem>
        <ContextMenuItem onClick={() => data.onTogglePause(agent)}>{agent.status === 'paused' ? 'Resume agent' : 'Pause agent'}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AgentDetailDrawer({
  agent,
  onClose,
  onMessage,
  onTogglePause,
  onTerminate,
}: {
  readonly agent: Agent;
  readonly onClose: () => void;
  readonly onMessage: () => void;
  readonly onTogglePause: (agent: Agent) => void;
  readonly onTerminate: (agentId: string) => void;
}) {
  const qualityScore = agent.qualityScore ?? 0;
  const messagesQuery = useAgentMessages(agent.id);
  const lineageQuery = useAgentLineage(agent.id);
  const dispatchMutation = useDispatchAgentTask(agent.id);
  const [taskDraft, setTaskDraft] = useState('');

  const logs = messagesQuery.data ?? [];
  const parents = lineageQuery.data?.parents ?? [];
  const children = lineageQuery.data?.children ?? [];

  const dispatchTask = async () => {
    if (!taskDraft.trim()) return;
    try {
      await dispatchMutation.mutateAsync(taskDraft.trim());
      toast.success('Task dispatched');
      setTaskDraft('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to dispatch task');
    }
  };

  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 260 }} className="absolute right-0 top-0 h-full w-[420px] border-l border-border bg-card z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{agent.name}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex-1 overflow-auto scrollbar-thin p-4 space-y-5">
        <section className="space-y-2">
          <div className="text-micro font-semibold text-muted-foreground uppercase">Identity</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Role:</span> {agent.role}</div>
            <div><span className="text-muted-foreground">Model:</span> <span className="font-mono">{agent.model}</span></div>
            <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{agent.id}</span></div>
            <div className="flex items-center gap-2"><span className="text-muted-foreground">Status:</span><StatusDot status={agent.status} size="sm" /></div>
          </div>
        </section>

        <section>
          <div className="text-micro font-semibold text-muted-foreground uppercase mb-2">Current State</div>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs">{agent.currentTask}</p>
            <div className="flex items-center gap-2 mt-2">
              <ConfidenceBar value={qualityScore} />
              <span className="text-micro font-mono text-muted-foreground">{qualityScore}%</span>
            </div>
          </div>
        </section>

        <section>
          <div className="text-micro font-semibold text-muted-foreground uppercase mb-2">Lineage</div>
          <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2 text-xs">
            <div>
              <div className="text-muted-foreground mb-1">Parents</div>
              {parents.length === 0 ? <div className="text-muted-foreground">None</div> : parents.map((parent) => (
                <div key={parent.id} className="flex items-center justify-between">
                  <span>{parent.name}</span>
                  <span className="font-mono text-micro text-muted-foreground">{parent.role}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-muted-foreground mb-1">Children</div>
              {children.length === 0 ? <div className="text-muted-foreground">None</div> : children.map((child) => (
                <div key={child.id} className="flex items-center justify-between">
                  <span>{child.name}</span>
                  <span className="text-micro text-muted-foreground">{child.status}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="text-micro font-semibold text-muted-foreground uppercase mb-2">Task Dispatch</div>
          <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
            <textarea
              value={taskDraft}
              onChange={(event) => setTaskDraft(event.target.value)}
              className="w-full min-h-24 rounded-md border border-border bg-card px-3 py-2 text-xs"
              placeholder="Dispatch a new task to this agent..."
            />
            <button
              onClick={() => void dispatchTask()}
              disabled={dispatchMutation.isPending}
              className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              <SendHorizontal className="h-3.5 w-3.5" /> Send Task
            </button>
          </div>
        </section>

        <section>
          <div className="text-micro font-semibold text-muted-foreground uppercase mb-2">Recent Logs</div>
          <div className="space-y-2 text-xs">
            {logs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-muted-foreground">No inbox activity yet.</div>
            ) : logs.map((log) => (
              <div key={log.id} className="rounded-md border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{log.status}</span>
                  <span className="text-micro text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-muted-foreground whitespace-pre-wrap">{log.content || 'No content'}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button onClick={onMessage} className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"><MessageSquare className="h-3.5 w-3.5" /> Message</button>
        <button onClick={() => onTogglePause(agent)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">{agent.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{agent.status === 'paused' ? 'Resume' : 'Pause'}</button>
        <button className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Settings className="h-3.5 w-3.5" /> Config</button>
        <button onClick={() => onTerminate(agent.id)} className="flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 ml-auto"><Trash2 className="h-3.5 w-3.5" /> Terminate</button>
      </div>
    </motion.div>
  );
}

function OrgChartView({ agents, onSelect }: { readonly agents: Agent[]; readonly onSelect: (id: string) => void }) {
  if (agents.length === 0) {
    return <EmptyGraphState />;
  }

  const root = agents[0];
  const children = agents.slice(1);
  return (
    <div className="flex flex-col items-center pt-12 gap-8 animate-fade-in">
      {root && <button onClick={() => onSelect(root.id)}><Card agent={root} isRoot /></button>}
      <div className="h-8 w-px bg-border" />
      <div className="flex gap-6 flex-wrap justify-center">
        {children.map((agent) => (
          <div key={agent.id} className="flex flex-col items-center gap-2">
            <div className="h-6 w-px bg-border" />
            <button onClick={() => onSelect(agent.id)}><Card agent={agent} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ agent, isRoot }: { readonly agent: Agent; readonly isRoot?: boolean }) {
  const qualityScore = agent.qualityScore ?? 0;
  return (
    <div className={cn('rounded-lg border bg-card px-4 py-3 hover:border-primary/40 transition-all min-w-[160px]', isRoot ? 'border-primary/30 glow-amber' : 'border-border')}>
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={agent.status} size="sm" />
        <span className="text-xs font-semibold truncate">{agent.name}</span>
      </div>
      <span className="text-micro text-muted-foreground font-mono block mb-1">{agent.model}</span>
      <p className="text-micro text-muted-foreground truncate mb-1.5">{agent.currentTask}</p>
      <ConfidenceBar value={qualityScore} bars={5} />
    </div>
  );
}

export default function HiveGraph() {
  const navigate = useNavigate();
  const { state } = useHiveData();
  const { setChatTargetAgentId, graphFocusAgentId, setGraphFocusAgentId } = useWorkspace();
  const pauseMutation = usePauseAgent();
  const resumeMutation = useResumeAgent();
  const terminateMutation = useTerminateAgent();
  const [view, setView] = useState<'org' | 'graph'>('graph');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showLocks, setShowLocks] = useState(false);
  const [spawnModalOpen, setSpawnModalOpen] = useState(false);
  const graph = useMemo(() => buildGraph(state.agents), [state.agents]);

  useEffect(() => {
    if (graphFocusAgentId) {
      setSelectedAgentId(graphFocusAgentId);
      setGraphFocusAgentId(null);
    }
  }, [graphFocusAgentId, setGraphFocusAgentId]);

  const visibleAgents = useMemo(() => state.agents.filter((agent) => !statusFilter || agent.status === statusFilter), [state.agents, statusFilter]);
  const filteredIds = useMemo(() => new Set(visibleAgents.map((agent) => agent.id)), [visibleAgents]);
  const searchLower = search.toLowerCase();

  const togglePause = useCallback(async (agent: Agent) => {
    try {
      if (agent.status === 'paused') {
        await resumeMutation.mutateAsync(agent.id);
        toast.success(`${agent.name} resumed`);
      } else {
        await pauseMutation.mutateAsync(agent.id);
        toast.success(`${agent.name} paused`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update agent state');
    }
  }, [pauseMutation, resumeMutation]);

  const terminateAgent = useCallback(async (agentId: string) => {
    try {
      await terminateMutation.mutateAsync(agentId);
      toast.success('Agent terminated');
      setSelectedAgentId((current) => (current === agentId ? null : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to terminate agent');
    }
  }, [terminateMutation]);

  const nodes = useMemo<Node[]>(() => graph.nodes.map((node) => {
    const agent = state.agents.find((candidate) => candidate.id === node.id)!;
    const matchesSearch = searchLower === '' || agent.name.toLowerCase().includes(searchLower) || agent.role.toLowerCase().includes(searchLower);
    return {
      ...node,
      data: {
        ...node.data,
        highlighted: matchesSearch,
        dimmed: (!filteredIds.has(node.id) || (searchLower !== '' && !matchesSearch)),
        locked: lockedAgents.has(node.id),
        showLock: showLocks,
        onMessage: (agentId: string) => { setChatTargetAgentId(agentId); navigate('/chat'); },
        onOpen: (agentId: string) => setSelectedAgentId(agentId),
        onTogglePause: (agentValue: Agent) => { void togglePause(agentValue); },
      },
    };
  }), [filteredIds, graph.nodes, navigate, searchLower, setChatTargetAgentId, showLocks, state.agents, togglePause]);

  const selectedAgent = selectedAgentId ? state.agents.find((agent) => agent.id === selectedAgentId) ?? null : null;

  return (
    <div className="flex flex-col h-full">
      <AgentSpawnModal open={spawnModalOpen} onOpenChange={setSpawnModalOpen} />

      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface-2">
            <button onClick={() => setView('org')} className={cn('px-3 py-1 text-xs rounded-l-md transition-colors', view === 'org' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
              <LayoutGrid className="h-3.5 w-3.5 inline mr-1" /> Org Chart
            </button>
            <button onClick={() => setView('graph')} className={cn('px-3 py-1 text-xs rounded-r-md transition-colors', view === 'graph' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
              <Network className="h-3.5 w-3.5 inline mr-1" /> Node Graph
            </button>
          </div>
          <div className="relative ml-4">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-7 rounded-md border border-border bg-surface-2 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground w-48" placeholder="Search agents..." />
          </div>
          <div className="flex gap-1 ml-2">
            {(['working', 'idle', 'blocked', 'paused'] as const).map((status) => (
              <button key={status} onClick={() => setStatusFilter(statusFilter === status ? null : status)} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro hover:border-primary/30', statusFilter === status ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
                <StatusDot status={status} size="sm" />
                {status}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowLocks((value) => !value)} className={cn('rounded-md border p-1 text-muted-foreground hover:text-foreground', showLocks && 'border-primary bg-primary/10 text-primary')}>
            <Lock className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setSpawnModalOpen(true)} className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"><Plus className="h-3.5 w-3.5" /> Spawn</button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {(() => {
          if (state.agents.length === 0) return <EmptyGraphState />;
          if (view === 'org') {
            const orgAgents = visibleAgents.length > 0 ? visibleAgents : state.agents;
            return <OrgChartView agents={orgAgents} onSelect={setSelectedAgentId} />;
          }
          return (
            <ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView
              onNodeClick={(_, node) => setSelectedAgentId(node.id)}
              onNodeDoubleClick={(_, node) => { setChatTargetAgentId(node.id); navigate('/chat'); }}
              proOptions={{ hideAttribution: true }} className="bg-background">
              <Background gap={24} size={1} color="hsl(var(--border))" />
              <Controls className="!bg-card !border-border !rounded-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-2" />
              <MiniMap nodeColor={(node) => lockedAgents.has(node.id) ? 'hsl(var(--info))' : 'hsl(var(--primary))'} maskColor="hsl(var(--background) / 0.8)" className="!bg-surface-2 !border-border !rounded-md" />
            </ReactFlow>
          );
        })()}

        {showLocks && (
          <div className="absolute left-4 bottom-4 rounded-lg border border-info/30 bg-card/95 p-3 text-xs shadow-lg">
            <div className="font-semibold text-info mb-1">Lock Overlay</div>
            <div className="text-muted-foreground">No agent file locks held.</div>
          </div>
        )}

        <AnimatePresence>
          {selectedAgent && (
            <AgentDetailDrawer
              agent={selectedAgent}
              onClose={() => setSelectedAgentId(null)}
              onMessage={() => { setChatTargetAgentId(selectedAgent.id); navigate('/chat'); }}
              onTogglePause={(agent) => { void togglePause(agent); }}
              onTerminate={(agentId) => { void terminateAgent(agentId); }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
