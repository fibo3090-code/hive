import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MarkerType, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ClipboardList, GitBranch, Rows3, Plus, Trash2, Pencil, Save, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Agent } from '@/types/domain';
import type { PlanEdge, PlanGraphPayload, PlanSprintNode, PlanTaskNode } from '@/api/planGraph';

type Mode = 'graph' | 'lanes' | 'list';

interface SprintPlanExplorerProps {
  plan: PlanGraphPayload;
  agents?: Agent[];
  editable?: boolean;
  compact?: boolean;
  onChange?: (plan: PlanGraphPayload) => void;
  onSave?: () => void;
  saving?: boolean;
}

const priorityClass: Record<string, string> = {
  high: 'border-destructive/50 text-destructive',
  medium: 'border-warning/50 text-warning',
  low: 'border-info/50 text-info',
};

function nextId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function GraphNode({ data }: { readonly data: { label: string; detail?: string; status?: string; expanded?: boolean; selected?: boolean; incoming?: number; outgoing?: number } }) {
  return (
    <div className={cn('min-w-[210px] rounded-md border bg-card px-3 py-2 shadow-lg transition-colors', data.selected ? 'border-primary ring-1 ring-primary/50' : 'border-border')}>
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-primary" />
        <span className="truncate text-xs font-semibold">{data.label}</span>
      </div>
      {data.detail && <div className="mt-1 truncate text-[10px] text-muted-foreground">{data.detail}</div>}
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{data.status ?? 'planned'}</span>
        <span>{data.incoming ?? 0} in · {data.outgoing ?? 0} out</span>
      </div>
    </div>
  );
}

const nodeTypes = { sprintPlanNode: GraphNode };

export function SprintPlanExplorer({
  plan,
  agents = [],
  editable = false,
  compact = false,
  onChange,
  onSave,
  saving,
}: SprintPlanExplorerProps) {
  const [mode, setMode] = useState<Mode>('graph');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(plan.sprintNodes[0]?.id ?? null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const roleOptions = useMemo(() => {
    const roles = new Set<string>();
    for (const agent of agents) roles.add(agent.role);
    for (const agent of plan.agents ?? []) roles.add(agent.role);
    return Array.from(roles).filter(Boolean);
  }, [agents, plan.agents]);

  const setPlan = (updater: (current: PlanGraphPayload) => PlanGraphPayload) => {
    onChange?.(updater(plan));
  };

  const addSprint = () => {
    const level = Math.max(0, ...plan.sprintNodes.map((s) => s.level)) + 1;
    const id = nextId('sprint');
    setPlan((current) => ({
      ...current,
      sprintNodes: [
        ...current.sprintNodes,
        { id, title: 'New mini-sprint', status: 'planned', level, order: 0, points: 1 },
      ],
      sprintEdges: current.sprintNodes.length
        ? [...current.sprintEdges, { id: nextId('edge'), from: current.sprintNodes.reduce((latest, sprint) => sprint.level > latest.level ? sprint : latest, current.sprintNodes[0]).id, to: id, kind: 'dependency' }]
        : current.sprintEdges,
    }));
  };

  const addTask = (sprintId: string) => {
    const tasks = plan.taskNodes.filter((task) => task.sprintId === sprintId);
    const id = nextId('task');
    setPlan((current) => ({
      ...current,
      taskNodes: [
        ...current.taskNodes,
        {
          id,
          sprintId,
          title: 'New task',
          priority: 'medium',
          agentRole: roleOptions[0] ?? 'Coordinator',
          status: 'pending',
          estimatedTokens: 1500,
          level: tasks.length,
          order: 0,
        },
      ],
      taskEdges: tasks.length
        ? [...current.taskEdges, { id: nextId('task-edge'), from: tasks[tasks.length - 1].id, to: id, kind: 'dependency' }]
        : current.taskEdges,
    }));
  };

  const removeSprint = (sprintId: string) => {
    const taskIds = new Set(plan.taskNodes.filter((task) => task.sprintId === sprintId).map((task) => task.id));
    setPlan((current) => ({
      ...current,
      sprintNodes: current.sprintNodes.filter((sprint) => sprint.id !== sprintId),
      sprintEdges: current.sprintEdges.filter((edge) => edge.from !== sprintId && edge.to !== sprintId),
      taskNodes: current.taskNodes.filter((task) => task.sprintId !== sprintId),
      taskEdges: current.taskEdges.filter((edge) => !taskIds.has(edge.from) && !taskIds.has(edge.to)),
    }));
  };

  const removeTask = (taskId: string) => {
    setPlan((current) => ({
      ...current,
      taskNodes: current.taskNodes.filter((task) => task.id !== taskId),
      taskEdges: current.taskEdges.filter((edge) => edge.from !== taskId && edge.to !== taskId),
    }));
  };

  const updateTask = (taskId: string, patch: Partial<PlanTaskNode>) => {
    setPlan((current) => ({
      ...current,
      taskNodes: current.taskNodes.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    }));
  };

  const updateSprint = (sprintId: string, patch: Partial<PlanSprintNode>) => {
    setPlan((current) => ({
      ...current,
      sprintNodes: current.sprintNodes.map((sprint) => (sprint.id === sprintId ? { ...sprint, ...patch } : sprint)),
    }));
  };

  const setSprintDependencies = (sprintId: string, fromIds: string[]) => {
    setPlan((current) => ({
      ...current,
      sprintEdges: [
        ...current.sprintEdges.filter((edge) => edge.to !== sprintId),
        ...fromIds.map((fromId) => ({ id: nextId('edge'), from: fromId, to: sprintId, kind: 'dependency' })),
      ],
    }));
  };

  const graph = useMemo(() => buildFlowGraph(plan, expanded, selectedSprintId), [plan, expanded, selectedSprintId]);
  const validation = useMemo(() => validatePlan(plan), [plan]);
  const selectedSprint = plan.sprintNodes.find((sprint) => sprint.id === selectedSprintId) ?? plan.sprintNodes[0] ?? null;
  const selectedTasks = selectedSprint ? plan.taskNodes.filter((task) => task.sprintId === selectedSprint.id) : [];
  const selectedDeps = selectedSprint ? plan.sprintEdges.filter((edge) => edge.to === selectedSprint.id).map((edge) => edge.from) : [];

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Sprint graph</h3>
          <p className="text-[11px] text-muted-foreground">
            {plan.sprintNodes.length} mini-sprints · {plan.taskNodes.length} tasks · logical sequence, not dates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md border border-border bg-surface-1 p-0.5">
            <button
              type="button"
              onClick={() => setMode('graph')}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs', mode === 'graph' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              <GitBranch className="h-3.5 w-3.5" /> Graph
            </button>
            <button
              type="button"
              onClick={() => setMode('lanes')}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs', mode === 'lanes' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              <Rows3 className="h-3.5 w-3.5" /> Agents
            </button>
            <button
              type="button"
              onClick={() => setMode('list')}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs', mode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              <ClipboardList className="h-3.5 w-3.5" /> List
            </button>
          </div>
          {editable && (
            <>
              <Button size="sm" variant="outline" onClick={addSprint} className="h-8 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Sprint
              </Button>
              {onSave && (
                <Button size="sm" onClick={onSave} disabled={saving || validation.length > 0} className="h-8 gap-1.5">
                  <Save className="h-3.5 w-3.5" /> Save
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {validation.length > 0 && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {validation.join(' · ')}
        </div>
      )}

      {mode === 'graph' ? (
        <div className={cn('relative w-full', compact ? 'h-[360px]' : 'h-[560px]')}>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.25}
            onNodeClick={(_, node) => {
              const sprint = plan.sprintNodes.find((item) => item.id === node.id);
              if (!sprint) return;
              setSelectedSprintId(sprint.id);
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(sprint.id)) next.delete(sprint.id);
                else next.add(sprint.id);
                return next;
              });
            }}
          >
            <Background gap={18} size={1} />
            <Controls />
          </ReactFlow>
          {selectedSprint && (
            <div className="absolute bottom-3 left-3 max-w-[360px] rounded-md border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
              <div className="text-xs font-semibold">{selectedSprint.title}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {selectedTasks.length} tasks · depends on {selectedDeps.length || 'nothing'} · {plan.sprintEdges.filter((edge) => edge.from === selectedSprint.id).length} outgoing
              </div>
              <div className="mt-2 max-h-24 overflow-auto space-y-1">
                {selectedTasks.map((task) => (
                  <div key={task.id} className="truncate text-[11px] text-muted-foreground">
                    {task.title}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : mode === 'list' ? (
        <TaskListView plan={plan} agents={agents} compact={compact} />
      ) : (
        <AgentLaneView plan={plan} agents={agents} compact={compact} />
      )}

      {editable && (
        <div className="border-t border-border p-4">
          <div className="grid gap-3">
            {plan.sprintNodes
              .slice()
              .sort((a, b) => a.level - b.level || a.order - b.order)
              .map((sprint) => {
                const sprintTasks = plan.taskNodes.filter((task) => task.sprintId === sprint.id);
                const isExpanded = expanded.has(sprint.id);
                const sprintDeps = plan.sprintEdges.filter((edge) => edge.to === sprint.id).map((edge) => edge.from);
                return (
                  <div key={sprint.id} className="rounded-md border border-border bg-surface-1 p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(sprint.id)) next.delete(sprint.id);
                          else next.add(sprint.id);
                          return next;
                        })}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <input
                        value={sprint.title}
                        onChange={(event) => updateSprint(sprint.id, { title: event.target.value })}
                        className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs font-medium"
                      />
                      <div className="flex max-w-[360px] flex-wrap gap-1">
                        {plan.sprintNodes
                          .filter((candidate) => candidate.id !== sprint.id)
                          .map((candidate) => {
                            const checked = sprintDeps.includes(candidate.id);
                            return (
                              <button
                                key={candidate.id}
                                type="button"
                                title={`Toggle dependency from ${candidate.title}`}
                                onClick={() => {
                                  setSprintDependencies(
                                    sprint.id,
                                    checked ? sprintDeps.filter((id) => id !== candidate.id) : [...sprintDeps, candidate.id],
                                  );
                                }}
                                className={cn('rounded border px-1.5 py-1 text-[10px]', checked ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
                              >
                                {candidate.level + 1}
                              </button>
                            );
                          })}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => addTask(sprint.id)} className="h-8 gap-1">
                        <Plus className="h-3.5 w-3.5" /> Task
                      </Button>
                      <button type="button" onClick={() => removeSprint(sprint.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 space-y-2 pl-6">
                        {sprintTasks.map((task) => (
                          <div key={task.id} className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
                            {editingTaskId === task.id ? (
                              <>
                                <input
                                  value={draftTitle}
                                  onChange={(event) => setDraftTitle(event.target.value)}
                                  className="h-8 flex-1 rounded-md border border-border bg-surface-2 px-2 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateTask(task.id, { title: draftTitle.trim() || task.title });
                                    setEditingTaskId(null);
                                  }}
                                  className="text-primary"
                                >
                                  <Save className="h-4 w-4" />
                                </button>
                                <button type="button" onClick={() => setEditingTaskId(null)} className="text-muted-foreground">
                                  <X className="h-4 w-4" />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="flex-1 truncate text-xs">{task.title}</span>
                                <select
                                  value={task.agentRole ?? ''}
                                  onChange={(event) => updateTask(task.id, { agentRole: event.target.value || null })}
                                  className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs"
                                >
                                  <option value="">Unassigned</option>
                                  {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTaskId(task.id);
                                    setDraftTitle(task.title);
                                  }}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button type="button" onClick={() => removeTask(task.id)} className="text-muted-foreground hover:text-destructive">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function buildFlowGraph(plan: PlanGraphPayload, expanded: Set<string>, selectedSprintId: string | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  for (const sprint of plan.sprintNodes) {
    const incoming = plan.sprintEdges.filter((edge) => edge.to === sprint.id).length;
    const outgoing = plan.sprintEdges.filter((edge) => edge.from === sprint.id).length;
    nodes.push({
      id: sprint.id,
      type: 'sprintPlanNode',
      position: { x: sprint.level * 280, y: sprint.order * 165 },
      data: {
        label: sprint.title,
        detail: `${plan.taskNodes.filter((task) => task.sprintId === sprint.id).length} tasks`,
        status: sprint.status ?? 'planned',
        expanded: expanded.has(sprint.id),
        selected: selectedSprintId === sprint.id,
        incoming,
        outgoing,
      },
    });
    if (expanded.has(sprint.id)) {
      plan.taskNodes
        .filter((task) => task.sprintId === sprint.id)
        .forEach((task, index) => {
          nodes.push({
            id: task.id,
            type: 'sprintPlanNode',
            position: { x: sprint.level * 280 + 46, y: sprint.order * 165 + 135 + index * 112 },
            data: { label: task.title, detail: task.agentRole ?? 'Unassigned', status: task.status ?? 'pending' },
          });
        });
    }
  }

  const edgeStyle = { stroke: 'hsl(var(--primary))', strokeWidth: 2.2 };
  const edges: Edge[] = [
    ...plan.sprintEdges.map((edge) => flowEdge(edge, edgeStyle)),
    ...plan.taskEdges
      .filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to))
      .map((edge) => flowEdge(edge, { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.2 })),
  ];
  return { nodes, edges };
}

function TaskListView({ plan, agents, compact }: { readonly plan: PlanGraphPayload; readonly agents: Agent[]; readonly compact?: boolean }) {
  const agentLabels = new Map<string, string>();
  for (const agent of agents) {
    agentLabels.set(agent.id, agent.name);
    agentLabels.set(agent.role, agent.name);
  }
  for (const agent of plan.agents ?? []) {
    agentLabels.set(agent.role, agent.name ?? agent.role);
  }
  const sprintById = new Map(plan.sprintNodes.map((sprint) => [sprint.id, sprint]));
  const sortedTasks = plan.taskNodes
    .slice()
    .sort((a, b) => {
      const sprintA = sprintById.get(a.sprintId);
      const sprintB = sprintById.get(b.sprintId);
      return (sprintA?.level ?? 0) - (sprintB?.level ?? 0) || a.level - b.level || a.order - b.order;
    });

  return (
    <div className={cn('overflow-auto p-4', compact ? 'max-h-[360px]' : 'max-h-[560px]')}>
      <div className="space-y-2">
        {sortedTasks.map((task, index) => {
          const sprint = sprintById.get(task.sprintId);
          const deps = plan.taskEdges.filter((edge) => edge.to === task.id).length;
          return (
            <div key={task.id} className="grid grid-cols-[42px_minmax(0,1fr)_140px_96px] items-center gap-3 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs">
              <div className="font-mono text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <div className="truncate font-medium">{task.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {sprint?.title ?? 'No sprint'} · step {(sprint?.level ?? 0) + 1}.{task.level + 1} · {deps} deps
                </div>
              </div>
              <div className="truncate text-muted-foreground">{agentLabels.get(task.agentId ?? task.agentRole ?? '') ?? task.agentRole ?? 'Unassigned'}</div>
              <div className={cn('rounded border px-2 py-1 text-center text-[10px]', priorityClass[task.priority ?? 'medium'])}>
                {task.status ?? 'pending'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function flowEdge(edge: PlanEdge, style: Edge['style']): Edge {
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    style,
  };
}

function AgentLaneView({ plan, agents, compact }: { readonly plan: PlanGraphPayload; readonly agents: Agent[]; readonly compact?: boolean }) {
  const lanes = useMemo(() => {
    const rows = new Map<string, { label: string; tasks: PlanTaskNode[] }>();
    for (const agent of agents) rows.set(agent.id, { label: agent.name, tasks: [] });
    for (const role of plan.agents ?? []) rows.set(role.role, { label: role.name ?? role.role, tasks: [] });
    rows.set('unassigned', { label: 'Unassigned', tasks: [] });
    for (const task of plan.taskNodes) {
      const key = task.agentId ?? task.agentRole ?? 'unassigned';
      if (!rows.has(key)) rows.set(key, { label: key, tasks: [] });
      rows.get(key)?.tasks.push(task);
    }
    return Array.from(rows.values()).filter((row) => row.tasks.length > 0 || !compact);
  }, [agents, compact, plan.agents, plan.taskNodes]);

  const maxLevel = Math.max(0, ...plan.taskNodes.map((task) => task.level));
  const levels = Array.from({ length: maxLevel + 1 }, (_, i) => i);

  return (
    <div className={cn('overflow-auto p-4', compact ? 'max-h-[360px]' : 'max-h-[620px]')}>
      <div className="min-w-[680px]">
        <div className="grid gap-2" style={{ gridTemplateColumns: `150px repeat(${levels.length}, minmax(170px, 1fr))` }}>
          <div />
          {levels.map((level) => (
            <div key={level} className="text-[10px] uppercase tracking-wide text-muted-foreground">Step {level + 1}</div>
          ))}
          {lanes.map((lane) => (
            <div key={lane.label} className="contents">
              <div className="sticky left-0 z-10 flex items-center rounded-md border border-border bg-card px-3 py-2 text-xs font-medium">
                {lane.label}
              </div>
              {levels.map((level) => {
                const tasks = lane.tasks.filter((task) => task.level === level);
                return (
                  <div key={`${lane.label}-${level}`} className="min-h-[74px] rounded-md border border-dashed border-border/70 bg-surface-1 p-2">
                    {tasks.map((task) => (
                      <div key={task.id} className={cn('mb-2 rounded-md border bg-card p-2 text-xs last:mb-0', priorityClass[task.priority ?? 'medium'])}>
                        <div className="font-medium leading-snug">{task.title}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">{task.status ?? 'pending'} · {task.estimatedTokens ?? 0} tok</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function validatePlan(plan: PlanGraphPayload): string[] {
  const errors: string[] = [];
  const sprintIds = new Set(plan.sprintNodes.map((sprint) => sprint.id));
  const taskIds = new Set(plan.taskNodes.map((task) => task.id));
  for (const task of plan.taskNodes) {
    if (!sprintIds.has(task.sprintId)) errors.push(`Task "${task.title}" is missing its mini-sprint`);
  }
  for (const edge of [...plan.sprintEdges, ...plan.taskEdges]) {
    const ids = plan.sprintEdges.includes(edge) ? sprintIds : taskIds;
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`Edge ${edge.id} references a missing node`);
  }
  if (hasCycle(sprintIds, plan.sprintEdges)) errors.push('Mini-sprint graph has a cycle');
  if (hasCycle(taskIds, plan.taskEdges)) errors.push('Task graph has a cycle');
  return errors;
}

function hasCycle(ids: Set<string>, edges: PlanEdge[]) {
  const incoming = new Map(Array.from(ids).map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const queue = Array.from(incoming.entries()).filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop()!;
    visited += 1;
    for (const child of outgoing.get(id) ?? []) {
      const next = (incoming.get(child) ?? 0) - 1;
      incoming.set(child, next);
      if (next === 0) queue.push(child);
    }
  }
  return visited !== ids.size;
}
