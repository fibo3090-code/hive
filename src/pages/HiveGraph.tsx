import { mockAgents } from '@/data/mockData';
import { StatusDot } from '@/components/shared/StatusDot';
import { ConfidenceBar } from '@/components/shared/ConfidenceBar';
import { Network, Search, Lock, Plus, ZoomIn, ZoomOut, LayoutGrid, X, MessageSquare, Pause, Settings, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Custom Node ─── */
function AgentNodeComponent({ data }: { data: any }) {
  const agent = data.agent;
  const borderColor =
    agent.status === 'working' ? 'border-success/40' :
    agent.status === 'blocked' ? 'border-destructive/40' :
    agent.status === 'paused' ? 'border-warning/40' : 'border-border';

  return (
    <div className={cn('rounded-lg border bg-card px-4 py-3 min-w-[160px] max-w-[200px] cursor-pointer hover:border-primary/40 transition-all', borderColor, data.isRoot && 'glow-amber border-primary/30')}>
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2 !border-0" />
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={agent.status} size="sm" />
        <span className="text-xs font-semibold truncate">{agent.name}</span>
      </div>
      <span className="text-micro text-muted-foreground font-mono block mb-1">{agent.model}</span>
      <p className="text-micro text-muted-foreground truncate mb-1.5">{agent.currentTask}</p>
      <ConfidenceBar value={agent.qualityScore} bars={5} />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2 !border-0" />
    </div>
  );
}

const nodeTypes = { agentNode: AgentNodeComponent };

/* ─── Initial nodes/edges from mock data ─── */
function buildGraphData() {
  const root = mockAgents[0];
  const children = mockAgents.slice(1);
  const spacing = 220;
  const startX = -((children.length - 1) * spacing) / 2;

  const nodes: Node[] = [
    { id: root.id, type: 'agentNode', position: { x: 0, y: 0 }, data: { agent: root, isRoot: true } },
    ...children.map((a, i) => ({
      id: a.id, type: 'agentNode' as const,
      position: { x: startX + i * spacing, y: 180 },
      data: { agent: a, isRoot: false },
    })),
  ];

  const edges: Edge[] = children.map((a) => ({
    id: `e-${root.id}-${a.id}`,
    source: root.id,
    target: a.id,
    animated: a.status === 'working',
    style: { stroke: 'hsl(var(--border))' },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--border))' },
  }));

  return { nodes, edges };
}

/* ─── Agent Detail Drawer ─── */
function AgentDetailDrawer({ agent, onClose }: { agent: typeof mockAgents[0]; onClose: () => void }) {
  const evalData = [
    { metric: 'Correctness', value: agent.evalScores.correctness },
    { metric: 'Style', value: agent.evalScores.style },
    { metric: 'Efficiency', value: agent.evalScores.efficiency },
    { metric: 'Testing', value: agent.evalScores.testQuality },
    { metric: 'Docs', value: agent.evalScores.docQuality },
  ];

  const mockLogs = [
    { time: '01:22:15', msg: 'Started task: ' + agent.currentTask },
    { time: '01:20:30', msg: 'Completed eval cycle — score: ' + agent.qualityScore + '%' },
    { time: '01:18:45', msg: 'Received instructions from Planning Engine' },
    { time: '01:15:00', msg: 'Waiting for resource lock on auth.ts' },
  ];

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="absolute right-0 top-0 h-full w-[400px] border-l border-border bg-card z-50 flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{agent.name}</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-4 space-y-5">
        {/* Identity */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Identity</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Role:</span> <span>{agent.role}</span></div>
            <div><span className="text-muted-foreground">Model:</span> <span className="font-mono">{agent.model}</span></div>
            <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{agent.id}</span></div>
            <div><span className="text-muted-foreground">Status:</span> <StatusDot status={agent.status} size="sm" /></div>
          </div>
        </section>

        {/* Current State */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Current State</h4>
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="text-xs">{agent.currentTask}</p>
            <div className="flex items-center gap-2 mt-2">
              <ConfidenceBar value={agent.qualityScore} />
              <span className="text-micro font-mono text-muted-foreground">{agent.qualityScore}%</span>
            </div>
          </div>
        </section>

        {/* Chain of Thought */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Chain of Thought</h4>
          <div className="rounded-md border border-border bg-surface-2 p-3 text-xs font-mono text-muted-foreground space-y-1">
            <p>1. Analyzing task requirements...</p>
            <p>2. Checking file dependencies: auth.ts, api.ts</p>
            <p>3. Requesting DLM lock on auth.ts</p>
            <p>4. Generating implementation plan...</p>
          </div>
        </section>

        {/* Eval Radar */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Eval History</h4>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={evalData}>
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <PolarRadiusAxis tick={false} domain={[0, 100]} />
              <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </section>

        {/* Recent Logs */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">Recent Logs</h4>
          <div className="space-y-1.5">
            {mockLogs.map((log, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="text-micro font-mono text-muted-foreground shrink-0">{log.time}</span>
                <span className="text-muted-foreground">{log.msg}</span>
              </div>
            ))}
          </div>
        </section>

        {/* To-Do */}
        <section>
          <h4 className="text-micro font-semibold text-muted-foreground uppercase mb-2">To-Do List</h4>
          <div className="space-y-1">
            {['Complete current task', 'Run eval cycle', 'Submit PR for review'].map((todo, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                {todo}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Action footer */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"><MessageSquare className="h-3.5 w-3.5" /> Message</button>
        <button className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Pause className="h-3.5 w-3.5" /> Pause</button>
        <button className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"><Settings className="h-3.5 w-3.5" /> Config</button>
        <button className="flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 ml-auto"><Trash2 className="h-3.5 w-3.5" /> Deprecate</button>
      </div>
    </motion.div>
  );
}

/* ─── Org Chart View ─── */
function OrgChartView({ onSelectAgent }: { onSelectAgent: (id: string) => void }) {
  return (
    <div className="flex flex-col items-center pt-12 gap-8 animate-fade-in">
      <div onClick={() => onSelectAgent(mockAgents[0].id)} className="cursor-pointer">
        <OrgAgentNode agent={mockAgents[0]} isRoot />
      </div>
      <div className="h-8 w-px bg-border" />
      <div className="flex gap-6 flex-wrap justify-center">
        {mockAgents.slice(1).map((agent) => (
          <div key={agent.id} className="flex flex-col items-center gap-2">
            <div className="h-6 w-px bg-border" />
            <div onClick={() => onSelectAgent(agent.id)} className="cursor-pointer">
              <OrgAgentNode agent={agent} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrgAgentNode({ agent, isRoot }: { agent: typeof mockAgents[0]; isRoot?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border bg-card px-4 py-3 hover:border-primary/40 transition-all min-w-[160px]',
      isRoot ? 'border-primary/30 glow-amber' :
      agent.status === 'working' ? 'border-success/20' :
      agent.status === 'blocked' ? 'border-destructive/20' :
      agent.status === 'paused' ? 'border-warning/20' : 'border-border'
    )}>
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

/* ─── Main Component ─── */
export default function HiveGraph() {
  const [view, setView] = useState<'org' | 'graph'>('graph');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => buildGraphData(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const selectedAgent = selectedAgentId ? mockAgents.find(a => a.id === selectedAgentId) : null;

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedAgentId(node.id);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
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
            <input value={search} onChange={e => setSearch(e.target.value)} className="h-7 rounded-md border border-border bg-surface-2 pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground w-48" placeholder="Search agents..." />
          </div>
          <div className="flex gap-1 ml-2">
            {(['working', 'idle', 'blocked', 'paused'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro hover:border-primary/30', statusFilter === s ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>
                <StatusDot status={s} size="sm" /> {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground"><Lock className="h-3.5 w-3.5" /></button>
          <button className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"><Plus className="h-3.5 w-3.5" /> Spawn</button>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative overflow-hidden">
        {view === 'org' ? (
          <OrgChartView onSelectAgent={setSelectedAgentId} />
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background gap={24} size={1} color="hsl(var(--border))" />
            <Controls className="!bg-card !border-border !rounded-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-surface-2" />
            <MiniMap
              nodeColor={() => 'hsl(var(--primary))'}
              maskColor="hsl(var(--background) / 0.8)"
              className="!bg-surface-2 !border-border !rounded-md"
            />
          </ReactFlow>
        )}

        <AnimatePresence>
          {selectedAgent && (
            <AgentDetailDrawer agent={selectedAgent} onClose={() => setSelectedAgentId(null)} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
