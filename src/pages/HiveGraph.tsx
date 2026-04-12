import { useEffect, useMemo, useState } from 'react';
import { mockAgents } from '@/data/mockData';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import { Network, Search, Lock, Plus, LayoutGrid, X, MessageSquare, Pause, Settings, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, Handle, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useWorkspace } from '@/context/WorkspaceContext';

const lockedAgents = new Set(['be-001', 'fe-001']);
const nodeTypes = { agentNode: AgentNode };

type AgentNodeData = {
  agent: typeof mockAgents[number];
  isRoot: boolean;
  highlighted: boolean;
  dimmed: boolean;
  locked: boolean;
  showLock: boolean;
  onMessage: (agentId: string) => void;
  onOpen: (agentId: string) => void;
  onTogglePause: (agentId: string) => void;
};

function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const root = mockAgents[0];
  const children = mockAgents.slice(1);
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

function AgentNode({ data }: { data: AgentNodeData }) {
  const agent = data.agent;
  const borderColor = agent.status === 'working' ? 'border-success/40' : agent.status === 'blocked' ? 'border-destructive/40' : agent.status === 'paused' ? 'border-warning/40' : 'border-border';
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
          <ConfidenceBar value={agent.qualityScore} bars={5} />
          {data.showLock && data.locked && <div className="absolute top-2 right-2 rounded-full bg-info/10 px-2 py-0.5 text-[10px] text-info">lock</div>}
          <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2 !border-0" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => data.onMessage(agent.id)}>Message agent</ContextMenuItem>
        <ContextMenuItem onClick={() => data.onOpen(agent.id)}>Open details</ContextMenuItem>
        <ContextMenuItem onClick={() => data.onTogglePause(agent.id)}>{agent.status === 'paused' ? 'Resume agent' : 'Pause agent'}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AgentDetailDrawer({ agent, onClose, onMessage }: { agent: typeof mockAgents[number]; onClose: () => void; onMessage: () => void }) {
  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 260 }} className="absolute right-0 top-0 h-full w-[380px] border-l border-border bg-card z-50 flex flex-col overflow-hidden">
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
              <ConfidenceBar value={agent.qualityScore} />
              <span className="text-micro font-mono text-muted-foreground">{agent.qualityScore}%</span>
            </div>
          </div>
        </section>
        <section>
          <div className="text-micro font-semibold text-muted-foreground uppercase mb-2">Recent Logs</div>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div>01:22:15 Started task: {agent.currentTask}</div>
            <div>01:20:30 Completed eval cycle — score: {agent.qualityScore}%</div>
            <div>01:18:45 Received instructions from Planning Engine</div>
            {lockedAgents.has(agent.id) && <div>01:16:10 Acquired file lock on active work item</div>}
          </div>
        </section>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button onClick={onMessage} className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"><MessageSquare className="h-3.5 w-3.5" /> Message</button>
        <button className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Pause className="h-3.5 w-3.5" /> Pause</button>
        <button className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Settings className="h-3.5 w-3.5" /> Config</button>
        <button className="flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 ml-auto"><Trash2 className="h-3.5 w-3.5" /> Deprecate</button>
      </div>
    </motion.div>
  );
}

function OrgChartView({ agents, onSelect }: { agents: typeof mockAgents; onSelect: (id: string) => void }) {
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

function Card({ agent, isRoot }: { agent: typeof mockAgents[number]; isRoot?: boolean }) {
  return (
    <div className={cn('rounded-lg border bg-card px-4 py-3 hover:border-primary/40 transition-all min-w-[160px]', isRoot ? 'border-primary/30 glow-amber' : 'border-border')}>
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={agent.status} size="sm" />
        <span className="text-xs font-semibold truncate">{agent.name}</span>
      </div>
      <span className="text-micro text-muted-foreground font-mono block mb-1">{agent.model}</span>
      <p className="text-micro text-muted-foreground truncate mb-1.5">{agent.currentTask}</p>
      <ConfidenceBar value={agent.qualityScore} bars={5} />
    </div>
  );
}

export default function HiveGraph() {
  const navigate = useNavigate();
  const { setChatTargetAgentId, graphFocusAgentId, setGraphFocusAgentId } = useWorkspace();
  const [view, setView] = useState<'org' | 'graph'>('graph');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showLocks, setShowLocks] = useState(false);
  const graph = useMemo(() => buildGraph(), []);

  useEffect(() => {
    if (graphFocusAgentId) {
      setSelectedAgentId(graphFocusAgentId);
      setGraphFocusAgentId(null);
    }
  }, [graphFocusAgentId, setGraphFocusAgentId]);

  const visibleAgents = useMemo(() => mockAgents.filter((agent) => !statusFilter || agent.status === statusFilter), [statusFilter]);
  const filteredIds = new Set(visibleAgents.map((agent) => agent.id));
  const searchLower = search.toLowerCase();

  const nodes = useMemo<Node[]>(() => graph.nodes.map((node) => {
    const agent = mockAgents.find((candidate) => candidate.id === node.id)!;
    const matchesSearch = searchLower === '' || agent.name.toLowerCase().includes(searchLower) || agent.role.toLowerCase().includes(searchLower);
    return {
      ...node,
      data: {
        ...node.data,
        highlighted: matchesSearch,
        dimmed: (!filteredIds.has(node.id) || (searchLower !== '' && !matchesSearch)),
        locked: lockedAgents.has(node.id),
        showLock: showLocks,
        onMessage: (agentId: string) => {
          setChatTargetAgentId(agentId);
          navigate('/chat');
        },
        onOpen: (agentId: string) => setSelectedAgentId(agentId),
        onTogglePause: (agentId: string) => setSelectedAgentId(agentId),
      },
    };
  }), [filteredIds, graph.nodes, navigate, searchLower, setChatTargetAgentId, showLocks]);

  const selectedAgent = selectedAgentId ? mockAgents.find((agent) => agent.id === selectedAgentId) ?? null : null;

  return (
    <div className="flex flex-col h-full">
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
          <button className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"><Plus className="h-3.5 w-3.5" /> Spawn</button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {view === 'org' ? (
          <OrgChartView agents={visibleAgents.length > 0 ? visibleAgents : mockAgents} onSelect={setSelectedAgentId} />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            onNodeClick={(_, node) => setSelectedAgentId(node.id)}
            onNodeDoubleClick={(_, node) => {
              setChatTargetAgentId(node.id);
              navigate('/chat');
            }}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background gap={24} size={1} color="hsl(var(--border))" />
            <Controls className="!bg-card !border-border !rounded-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-2" />
            <MiniMap nodeColor={(node) => lockedAgents.has(node.id) ? 'hsl(var(--info))' : 'hsl(var(--primary))'} maskColor="hsl(var(--background) / 0.8)" className="!bg-surface-2 !border-border !rounded-md" />
          </ReactFlow>
        )}

        {showLocks && (
          <div className="absolute left-4 bottom-4 rounded-lg border border-info/30 bg-card/95 p-3 text-xs shadow-lg">
            <div className="font-semibold text-info mb-1">Lock Overlay</div>
            <div className="text-muted-foreground">Frontend Architect and Backend Engineer currently hold file locks.</div>
          </div>
        )}

        <AnimatePresence>
          {selectedAgent && (
            <AgentDetailDrawer
              agent={selectedAgent}
              onClose={() => setSelectedAgentId(null)}
              onMessage={() => {
                setChatTargetAgentId(selectedAgent.id);
                navigate('/chat');
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
