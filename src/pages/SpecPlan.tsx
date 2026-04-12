import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FileText, BookOpen, CalendarDays, AlertTriangle, CheckSquare, ChevronDown, ChevronRight, Edit3, GripVertical, LayoutGrid, List } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';

const tabs = [
  { id: 'prd', label: 'PRD', icon: FileText },
  { id: 'stories', label: 'User Stories', icon: BookOpen },
  { id: 'sprint', label: 'Sprint Plan', icon: CalendarDays },
  { id: 'drift', label: 'Spec Drift', icon: AlertTriangle },
  { id: 'status', label: 'Implementation', icon: CheckSquare },
] as const;

const mockRequirements = [
  { id: 'REQ-001', title: 'User Authentication', status: 'implemented', drift: false, section: '3.1', description: 'Users must be able to sign up, log in, and manage sessions. Support JWT with httpOnly cookies and refresh token rotation.', children: ['REQ-001a', 'REQ-001b'] },
  { id: 'REQ-002', title: 'Agent CRUD Operations', status: 'in-progress', drift: false, section: '3.2', description: 'Support creating, reading, updating, and deprecating agents. Include role assignment and model configuration.' },
  { id: 'REQ-003', title: 'Real-time Chat Interface', status: 'in-progress', drift: true, section: '3.3', description: 'WebSocket-based chat with agent-specific channels. Support code blocks, AG-UI widgets, and token counting.' },
  { id: 'REQ-004', title: 'Budget Management', status: 'planned', drift: false, section: '3.4', description: 'Per-session budget caps with real-time tracking. Alert at 70%, 85%, 95% thresholds. Support budget extensions.' },
  { id: 'REQ-005', title: 'Eval Scoring System', status: 'implemented', drift: false, section: '3.5', description: 'Multi-dimensional eval: correctness, style, efficiency, test quality, documentation quality. Radar chart visualization.' },
  { id: 'REQ-006', title: 'File Locking (DLM)', status: 'planned', drift: false, section: '3.6', description: 'Distributed lock manager for file-level and function-level locking. Support exclusive and shared locks.' },
  { id: 'REQ-007', title: 'Spec Drift Detection', status: 'in-progress', drift: true, section: '3.7', description: 'Automatic comparison of implementation vs. PRD. Similarity scoring and drift alerts with resolution actions.' },
];

const mockStories = [
  { id: 'US-001', title: 'As a user, I can create a new project', points: 5, status: 'done', sprint: 'Sprint 2', acceptanceCriteria: ['Form validates inputs', 'Project appears in list', 'Onboarding wizard launches'] },
  { id: 'US-002', title: 'As a user, I can view agent status in real-time', points: 8, status: 'in-progress', sprint: 'Sprint 3', acceptanceCriteria: ['Status dots update live', 'Agent card shows current task', 'Eval scores visible'] },
  { id: 'US-003', title: 'As a user, I can message agents via Chat Central', points: 13, status: 'in-progress', sprint: 'Sprint 3', acceptanceCriteria: ['Messages render with agent avatar', 'Code blocks highlighted', 'Token count shown', 'AG-UI widgets render'] },
  { id: 'US-004', title: 'As a user, I can review agent-authored code diffs', points: 8, status: 'planned', sprint: 'Sprint 4', acceptanceCriteria: ['Side-by-side diff view', 'Accept/reject per chunk', 'Agent annotations visible'] },
  { id: 'US-005', title: 'As a user, I can set budget limits per session', points: 5, status: 'planned', sprint: 'Sprint 4', acceptanceCriteria: ['Budget slider works', 'Alert thresholds configurable', 'Real-time cost display'] },
  { id: 'US-006', title: 'As a user, I can view eval leaderboard', points: 3, status: 'done', sprint: 'Sprint 2', acceptanceCriteria: ['Podium display', 'Sortable table', 'Radar chart expansion'] },
];

const mockSprints = [
  { id: 'sprint-3', name: 'Sprint 3', status: 'active', progress: 45, startDate: 'Apr 1', endDate: 'Apr 14', tasks: 12, completed: 5, velocity: 34, points: 42 },
  { id: 'sprint-4', name: 'Sprint 4', status: 'planned', progress: 0, startDate: 'Apr 15', endDate: 'Apr 28', tasks: 8, completed: 0, velocity: null, points: 31 },
  { id: 'sprint-2', name: 'Sprint 2', status: 'completed', progress: 100, startDate: 'Mar 18', endDate: 'Mar 31', tasks: 10, completed: 10, velocity: 38, points: 38 },
];

const statusColors: Record<string, string> = { implemented: 'text-success', 'in-progress': 'text-warning', planned: 'text-muted-foreground', done: 'text-success' };
const statusBg: Record<string, string> = { active: 'border-primary/30 bg-primary/5', completed: 'border-success/30 bg-success/5', planned: 'border-border' };

export default function SpecPlan() {
  const [tab, setTab] = useState('prd');

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors', tab === t.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 animate-fade-in">
        {tab === 'prd' && <PRDTab />}
        {tab === 'stories' && <StoriesTab />}
        {tab === 'sprint' && <SprintTab />}
        {tab === 'drift' && <DriftTab />}
        {tab === 'status' && <StatusTab />}
      </div>
    </div>
  );
}

function PRDTab() {
  const [expanded, setExpanded] = useState<string | null>('REQ-001');
  const [editMode, setEditMode] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Product Requirements Document</h2>
        <button onClick={() => setEditMode(!editMode)} className={cn('flex items-center gap-1 text-xs rounded-md px-3 py-1.5 border', editMode ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
          <Edit3 className="h-3.5 w-3.5" /> {editMode ? 'Editing' : 'Edit'}
        </button>
      </div>
      <div className="space-y-2">
        {mockRequirements.map(req => (
          <div key={req.id} className={cn('rounded-lg border bg-card overflow-hidden transition-colors', req.drift ? 'border-warning/40' : 'border-border', expanded === req.id && 'border-primary/30')}>
            <button onClick={() => setExpanded(expanded === req.id ? null : req.id)} className="flex items-center gap-3 w-full p-4 text-left hover:bg-surface-2/50 transition-colors">
              {expanded === req.id ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <span className="text-micro font-mono text-muted-foreground">{req.id}</span>
              <span className="text-sm font-medium flex-1">{req.title}</span>
              <span className={cn('text-micro font-medium', statusColors[req.status])}>{req.status}</span>
              {req.drift && <span className="text-micro text-warning bg-warning/10 px-2 py-0.5 rounded-full">drift</span>}
              <span className="text-micro text-muted-foreground">§{req.section}</span>
            </button>
            <AnimatePresence>
              {expanded === req.id && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4 pt-0 border-t border-border">
                    {editMode ? (
                      <textarea className="w-full rounded-md border border-border bg-surface-2 p-3 text-sm mt-3 resize-none h-20" defaultValue={req.description} />
                    ) : (
                      <p className="text-sm text-muted-foreground mt-3">{req.description}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}

function StoriesTab() {
  const [filter, setFilter] = useState('all');
  const statuses = ['all', 'done', 'in-progress', 'planned'];
  const filtered = filter === 'all' ? mockStories : mockStories.filter(s => s.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">User Stories</h2>
        <div className="flex gap-1">
          {statuses.map(s => (
            <button key={s} onClick={() => setFilter(s)} className={cn('rounded-full px-2.5 py-1 text-micro capitalize', filter === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>{s}</button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {filtered.map(story => (
          <motion.div key={story.id} layout className="rounded-lg border border-border bg-card p-4 hover:border-primary/30 cursor-pointer transition-colors">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-micro font-mono text-muted-foreground">{story.id}</span>
              <span className="text-sm font-medium flex-1">{story.title}</span>
              <span className={cn('text-micro font-medium', statusColors[story.status])}>{story.status}</span>
              <span className="text-micro font-mono text-primary">{story.points} pts</span>
              <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{story.sprint}</span>
            </div>
            <div className="pl-16 space-y-1">
              {story.acceptanceCriteria.map((ac, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckSquare className={cn('h-3 w-3', story.status === 'done' ? 'text-success' : 'text-muted-foreground/40')} />
                  {ac}
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SprintTab() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Sprint Plan</h2>
      <div className="space-y-3">
        {mockSprints.map(sprint => (
          <div key={sprint.id} className={cn('rounded-lg border bg-card p-4', statusBg[sprint.status] || 'border-border')}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <GripVertical className="h-4 w-4 text-muted-foreground/30 cursor-grab" />
                <h3 className="text-sm font-semibold">{sprint.name}</h3>
                <span className={cn('text-micro font-medium capitalize', sprint.status === 'active' ? 'text-primary' : sprint.status === 'completed' ? 'text-success' : 'text-muted-foreground')}>{sprint.status}</span>
              </div>
              <span className="text-micro text-muted-foreground">{sprint.startDate} — {sprint.endDate}</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <Progress value={sprint.progress} className="flex-1 h-1.5" />
              <span className="text-micro font-mono text-muted-foreground">{sprint.completed}/{sprint.tasks}</span>
            </div>
            <div className="flex items-center gap-4 text-micro text-muted-foreground">
              <span>{sprint.points} story points</span>
              {sprint.velocity && <span>Velocity: {sprint.velocity} pts/sprint</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriftTab() {
  const driftItems = mockRequirements.filter(r => r.drift);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Spec Drift Alerts</h2>
      {driftItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spec drift detected. ✓</p>
      ) : (
        <div className="space-y-3">
          {driftItems.map(req => (
            <div key={req.id} className="rounded-lg border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-center gap-3 mb-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium flex-1">{req.title}</span>
                <span className="text-micro text-muted-foreground">{req.id}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{req.description}</p>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-micro text-muted-foreground">Similarity score:</span>
                <div className="flex items-center gap-2">
                  <Progress value={72} className="w-24 h-1.5" />
                  <span className="text-micro font-mono text-warning">72%</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="text-xs text-primary hover:underline">Update PRD</button>
                <button className="text-xs text-muted-foreground hover:underline">Revert Implementation</button>
                <button className="text-xs text-muted-foreground hover:underline">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusTab() {
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');
  const statusGroups = ['implemented', 'in-progress', 'planned'];
  const kanbanColors: Record<string, string> = { implemented: 'text-success', 'in-progress': 'text-warning', planned: 'text-muted-foreground' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Implementation Status</h2>
        <div className="flex gap-1">
          <button onClick={() => setViewMode('table')} className={cn('p-1.5 rounded', viewMode === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}><List className="h-4 w-4" /></button>
          <button onClick={() => setViewMode('kanban')} className={cn('p-1.5 rounded', viewMode === 'kanban' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}><LayoutGrid className="h-4 w-4" /></button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="rounded-lg border border-border bg-card">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Requirement</th>
              <th className="text-left px-4 py-2 font-medium">Section</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Drift</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {mockRequirements.map(req => (
                <tr key={req.id} className="hover:bg-surface-2/50 cursor-pointer">
                  <td className="px-4 py-2 font-medium">{req.title}</td>
                  <td className="px-4 py-2 font-mono text-muted-foreground">§{req.section}</td>
                  <td className="px-4 py-2"><span className={cn('text-micro font-medium', statusColors[req.status])}>{req.status}</span></td>
                  <td className="px-4 py-2">{req.drift ? <span className="text-warning text-micro">⚠ drift</span> : <span className="text-success text-micro">✓</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {statusGroups.map(status => (
            <div key={status}>
              <h4 className={cn('text-xs font-semibold uppercase mb-3', kanbanColors[status])}>{status} ({mockRequirements.filter(r => r.status === status).length})</h4>
              <div className="space-y-2">
                {mockRequirements.filter(r => r.status === status).map(req => (
                  <motion.div key={req.id} layout className="rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-primary/30 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-micro font-mono text-muted-foreground">{req.id}</span>
                      {req.drift && <AlertTriangle className="h-3 w-3 text-warning" />}
                    </div>
                    <h5 className="text-sm font-medium">{req.title}</h5>
                    <span className="text-micro text-muted-foreground">§{req.section}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
