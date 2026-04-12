import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { mockAgents } from '@/data/mockData';
import { BarChart3, Trophy, Brain, Activity, BookOpen, Bug, PlayCircle, Search, Download, Play, Pause, SkipBack, SkipForward, Plus } from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';

const tabs = [
  { id: 'agent', label: 'Agent Metrics', icon: BarChart3 },
  { id: 'project', label: 'Project Metrics', icon: Activity },
  { id: 'leaderboard', label: 'Eval Leaderboard', icon: Trophy },
  { id: 'traces', label: 'Langfuse Traces', icon: Brain },
  { id: 'hivemind', label: 'Hive Mind', icon: BookOpen },
  { id: 'techdebt', label: 'Tech Debt', icon: Bug },
  { id: 'replay', label: 'Session Replay', icon: PlayCircle },
] as const;

const replayEvents = [
  { time: '00:00', type: 'start', text: 'Session started', color: 'bg-primary' },
  { time: '00:05', type: 'agent', text: 'Planning Engine began sprint planning', color: 'bg-success' },
  { time: '00:12', type: 'agent', text: 'Frontend Architect started dashboard work', color: 'bg-info' },
  { time: '00:18', type: 'alert', text: 'Loop detected in Doc Writer', color: 'bg-warning' },
  { time: '00:25', type: 'commit', text: 'Backend Engineer committed auth middleware', color: 'bg-success' },
  { time: '00:35', type: 'alert', text: 'Budget at 71%', color: 'bg-warning' },
  { time: '00:45', type: 'agent', text: 'QA Sentinel began testing', color: 'bg-info' },
  { time: '01:00', type: 'error', text: '2 WebSocket tests failed', color: 'bg-destructive' },
  { time: '01:15', type: 'commit', text: 'Frontend Architect submitted PR #12', color: 'bg-success' },
  { time: '01:23', type: 'current', text: 'Current position', color: 'bg-primary' },
] as const;

export default function Insights() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('agent');

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border py-2">
        {tabs.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} className={cn('flex items-center gap-2 w-full px-4 py-2 text-xs transition-colors', tab === item.id ? 'bg-primary/10 text-primary border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin p-6 space-y-6 animate-fade-in">
        {tab === 'agent' && <MetricsGrid title="Agent Metrics" rows={[{ label: 'Avg Quality', value: '88%' }, { label: 'Total Tokens', value: '442K' }, { label: 'Avg Latency', value: '2.3s' }, { label: 'Success Rate', value: '94%' }]} />}
        {tab === 'project' && <MetricsGrid title="Project Metrics" rows={[{ label: 'Total Cost', value: '$142' }, { label: 'Lines Written', value: '4,821' }, { label: 'Files Modified', value: '38' }, { label: 'Session Duration', value: '1h 23m' }]} actionLabel="Export CSV" />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'traces' && <TraceList />}
        {tab === 'hivemind' && <HiveMindBoard />}
        {tab === 'techdebt' && <TechDebtBoard />}
        {tab === 'replay' && <SessionReplay />}
      </div>
    </div>
  );
}

function MetricsGrid({ title, rows, actionLabel }: { title: string; rows: { label: string; value: string }[]; actionLabel?: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actionLabel && <button className="flex items-center gap-1 text-xs text-primary hover:underline"><Download className="h-3.5 w-3.5" /> {actionLabel}</button>}
      </div>
      <div className="grid grid-cols-4 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-lg border border-border bg-card p-3">
            <span className="text-micro text-muted-foreground">{row.label}</span>
            <span className="block text-lg font-semibold font-mono mt-1">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard() {
  const sorted = [...mockAgents].sort((left, right) => right.qualityScore - left.qualityScore);
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Eval Leaderboard</h2>
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">Agent</th><th className="text-left px-4 py-2">Role</th><th className="text-left px-4 py-2">Quality</th></tr></thead>
          <tbody className="divide-y divide-border">
            {sorted.map((agent, index) => <tr key={agent.id} className="hover:bg-surface-2/50"><td className="px-4 py-2 font-mono text-muted-foreground">{index + 1}</td><td className="px-4 py-2 font-medium">{agent.name}</td><td className="px-4 py-2 text-muted-foreground">{agent.role}</td><td className="px-4 py-2 font-mono text-primary">{agent.qualityScore}%</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TraceList() {
  const traces = [
    { id: 't1', name: 'Planning Engine → Sprint Planning', duration: '3.2s', tokens: 4500, status: 'success' },
    { id: 't2', name: 'Frontend Architect → Dashboard Build', duration: '5.1s', tokens: 8200, status: 'success' },
    { id: 't3', name: 'QA Sentinel → Test Execution', duration: '2.1s', tokens: 3100, status: 'error' },
  ];
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Langfuse Traces</h2>
      <div className="space-y-2">
        {traces.map((trace) => <div key={trace.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3"><div className={cn('h-2 w-2 rounded-full', trace.status === 'success' ? 'bg-success' : 'bg-destructive')} /><span className="text-sm font-medium flex-1">{trace.name}</span><span className="text-micro font-mono text-muted-foreground">{trace.duration}</span><span className="text-micro font-mono text-muted-foreground">{trace.tokens} tok</span></div>)}
      </div>
    </div>
  );
}

function HiveMindBoard() {
  const { hiveMindNotes, addHiveMindNote } = useWorkspace();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const categories = ['all', 'Architecture', 'Decisions', 'Patterns', 'Issues', 'Auto-generated'];
  const filtered = hiveMindNotes.filter((note) => (category === 'all' || note.category === category) && (search === '' || note.title.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Hive Mind Board</h2>
        <button onClick={() => setCreating((value) => !value)} className="flex items-center gap-1 rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"><Plus className="h-3.5 w-3.5" /> New Note</button>
      </div>

      {creating && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Note title" className="w-full h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
          <textarea value={newContent} onChange={(event) => setNewContent(event.target.value)} placeholder="Add the key insight or decision..." className="w-full rounded-md border border-border bg-surface-2 p-3 text-sm h-24 resize-none" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreating(false)} className="rounded-md border border-border px-3 py-2 text-xs">Cancel</button>
            <button onClick={() => {
              if (!newTitle.trim() || !newContent.trim()) return;
              addHiveMindNote({ category: 'Decisions', title: newTitle.trim(), content: newContent.trim() });
              setNewTitle('');
              setNewContent('');
              setCreating(false);
            }} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground">Add Note</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full h-8 rounded-md border border-border bg-surface-2 pl-8 pr-3 text-xs placeholder:text-muted-foreground" placeholder="Search notes..." />
        </div>
        <div className="flex gap-1">
          {categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={cn('rounded-full px-2.5 py-1 text-micro capitalize', category === item ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>{item}</button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.map((note) => (
          <div key={note.id} className={cn('rounded-lg border bg-card p-4 hover:border-primary/30 transition-colors', note.auto ? 'border-primary/20' : 'border-border')}>
            <div className="flex items-center gap-2 mb-2">
              {note.auto && <span className="text-micro bg-primary/10 text-primary px-1.5 py-0.5 rounded">auto</span>}
              <span className="text-micro bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">{note.category}</span>
              <span className="text-micro text-muted-foreground ml-auto">{note.time}</span>
            </div>
            <h4 className="text-sm font-semibold mb-2">{note.title}</h4>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{note.content}</div>
            <div className="mt-2 text-micro text-muted-foreground">— {note.author}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TechDebtBoard() {
  const { techDebtItems, moveTechDebtItem } = useWorkspace();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const columns = ['high', 'medium', 'low'] as const;
  const colors = { high: 'text-destructive', medium: 'text-warning', low: 'text-info' };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Tech Debt Board</h2>
      <div className="grid grid-cols-3 gap-4">
        {columns.map((column) => (
          <div key={column} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedId && moveTechDebtItem(draggedId, column)}>
            <h4 className={cn('text-xs font-semibold uppercase mb-3', colors[column])}>{column} Priority</h4>
            <div className="space-y-2 min-h-[220px] rounded-lg border border-dashed border-border/60 p-2">
              {techDebtItems.filter((item) => item.severity === column).map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggedId(item.id)}
                  onDragEnd={() => setDraggedId(null)}
                  className="rounded-lg border border-border bg-card p-3 hover:border-primary/30 cursor-grab active:cursor-grabbing transition-colors"
                >
                  <h5 className="text-sm font-medium mb-1">{item.title}</h5>
                  <p className="text-micro text-muted-foreground mb-1">{item.description}</p>
                  <p className="text-micro text-muted-foreground italic mb-1">Impact: {item.impact}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-micro font-mono text-muted-foreground">{item.file}</span>
                    {item.lines > 0 && <span className="text-micro text-muted-foreground">{item.lines} lines</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionReplay() {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [index, setIndex] = useState(3);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current >= replayEvents.length - 1 ? current : current + 1));
    }, Math.max(250, 900 / speed));
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const progress = replayEvents.length <= 1 ? 0 : (index / (replayEvents.length - 1)) * 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Session Replay</h2>
        <select className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs">
          <option>Current Session (01:23:45)</option>
          <option>Session Mar 31 (2:15:00)</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => setIndex((current) => Math.max(0, current - 1))} className="text-muted-foreground hover:text-foreground"><SkipBack className="h-4 w-4" /></button>
          <button onClick={() => setPlaying((value) => !value)} className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={() => setIndex((current) => Math.min(replayEvents.length - 1, current + 1))} className="text-muted-foreground hover:text-foreground"><SkipForward className="h-4 w-4" /></button>
          <div className="flex gap-1 ml-4">
            {[0.5, 1, 2, 4].map((value) => <button key={value} onClick={() => setSpeed(value)} className={cn('px-2 py-0.5 text-micro rounded', speed === value ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>{value}x</button>)}
          </div>
          <span className="text-xs font-mono text-muted-foreground ml-auto">{replayEvents[index]?.time ?? '00:00'} / 01:23</span>
        </div>

        <div className="relative h-6 bg-surface-2 rounded overflow-hidden cursor-pointer" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          setIndex(Math.round(ratio * (replayEvents.length - 1)));
        }}>
          {replayEvents.map((event, eventIndex) => <div key={event.time} className={cn('absolute top-1 w-1.5 h-4 rounded-full', event.color)} style={{ left: `${(eventIndex / (replayEvents.length - 1)) * 100}%` }} />)}
          <div className="absolute top-0 bottom-0 bg-primary/20 rounded-l" style={{ width: `${progress}%` }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-primary" style={{ left: `${progress}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h4 className="text-xs font-semibold mb-3">Graph Snapshot at {replayEvents[index]?.time}</h4>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm" style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-md border border-primary/30 bg-card px-3 py-2 text-xs glow-amber">{replayEvents[index]?.text}</div>
              <div className="flex gap-4">
                {['Frontend', 'Backend', 'QA'].map((label) => <div key={label} className="rounded-md border border-border bg-card px-3 py-2 text-micro">{label}</div>)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-2.5 border-b border-border text-xs font-semibold">Event Log</div>
          <div className="max-h-[240px] overflow-auto scrollbar-thin divide-y divide-border">
            {replayEvents.map((event, eventIndex) => (
              <button key={event.time} onClick={() => setIndex(eventIndex)} className={cn('flex items-center gap-3 w-full px-4 py-2 text-xs text-left', eventIndex > index && 'opacity-30')}>
                <div className={cn('h-2 w-2 rounded-full shrink-0', event.color)} />
                <span className="font-mono text-muted-foreground w-12">{event.time}</span>
                <span className="flex-1">{event.text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
