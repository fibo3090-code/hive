import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { GitBranch, File, FolderOpen, Lock, Check, X, ChevronDown, ChevronRight, Bot, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  status?: 'M' | 'A' | '🔒';
  children?: FileNode[];
};

type PullRequest = {
  id: string;
  title: string;
  status: 'open' | 'review' | 'merged';
  author: string;
  focusFile: string;
  diffFile: string;
  reviewers: string[];
};

type DiffDecision = 'accepted' | 'rejected' | null;

const fileTree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'folder',
    children: [
      {
        name: 'components',
        path: 'src/components',
        type: 'folder',
        children: [
          { name: 'Dashboard.tsx', path: 'src/components/Dashboard.tsx', type: 'file', status: 'M' },
          { name: 'Sidebar.tsx', path: 'src/components/Sidebar.tsx', type: 'file', status: 'M' },
          { name: 'AgentCard.tsx', path: 'src/components/AgentCard.tsx', type: 'file', status: 'A' },
        ],
      },
      {
        name: 'lib',
        path: 'src/lib',
        type: 'folder',
        children: [
          { name: 'api.ts', path: 'src/lib/api.ts', type: 'file', status: 'M' },
          { name: 'auth.ts', path: 'src/lib/auth.ts', type: 'file', status: '🔒' },
          { name: 'types.ts', path: 'src/lib/types.ts', type: 'file', status: 'A' },
        ],
      },
    ],
  },
  { name: 'package.json', path: 'package.json', type: 'file', status: 'M' },
];

const fileContents: Record<string, string> = {
  'src/components/Dashboard.tsx': `import { TileGrid } from './TileGrid';\n\nexport function Dashboard() {\n  const tiles = [\n    { label: 'Health', value: 87 },\n    { label: 'Budget', value: '$142' },\n    { label: 'Spec', value: '73%' },\n  ];\n\n  return <TileGrid tiles={tiles} columns={3} />;\n}`,
  'src/components/Sidebar.tsx': `export function Sidebar() {\n  return <aside className="border-r border-border">Sidebar</aside>;\n}`,
  'src/components/AgentCard.tsx': `export function AgentCard() {\n  return <div className="rounded-lg border border-border bg-card p-4">Agent</div>;\n}`,
  'src/lib/api.ts': `export async function fetchData() {\n  const response = await fetch('/api/data');\n  return response.json();\n}`,
  'src/lib/auth.ts': `export function validateToken(token: string) {\n  return token.length > 0;\n}`,
  'src/lib/types.ts': `export type SessionInfo = {\n  budgetTotal: number;\n  budgetUsed: number;\n};`,
  'package.json': `{\n  "name": "vite_react_shadcn_ts",\n  "version": "0.0.0"\n}`,
};

const pullRequests: PullRequest[] = [
  { id: '#12', title: 'Dashboard components', status: 'open', author: 'Frontend Architect', focusFile: 'src/components/Dashboard.tsx', diffFile: 'src/components/Dashboard.tsx', reviewers: ['QA Sentinel'] },
  { id: '#11', title: 'Auth middleware', status: 'review', author: 'Backend Engineer', focusFile: 'src/lib/auth.ts', diffFile: 'src/lib/auth.ts', reviewers: ['Security Auditor', 'QA Sentinel'] },
  { id: '#10', title: 'Test coverage boost', status: 'merged', author: 'QA Sentinel', focusFile: 'src/lib/api.ts', diffFile: 'src/lib/api.ts', reviewers: [] },
];

const commits = [
  { hash: 'a3f2c1d', message: 'feat: implement dashboard summary tiles', author: 'Frontend Architect', time: '5 min ago', branch: 'feature/dashboard', session: 'current' },
  { hash: 'b8e4f2a', message: 'feat: add auth middleware with JWT validation', author: 'Backend Engineer', time: '12 min ago', branch: 'feature/auth', session: 'current' },
  { hash: 'c1d5e3b', message: 'test: add integration tests for auth flow', author: 'QA Sentinel', time: '18 min ago', branch: 'feature/auth', session: 'current' },
  { hash: 'd4f6a2c', message: 'refactor: optimize database query patterns', author: 'Backend Engineer', time: '25 min ago', branch: 'main', session: 'previous' },
];

const lockRows = [
  { file: 'src/lib/auth.ts', function: 'validateToken()', agent: 'Backend Engineer', duration: '4m 23s', type: 'exclusive' },
  { file: 'src/lib/api.ts', function: 'fetchData()', agent: 'Frontend Architect', duration: '1m 12s', type: 'shared' },
];

const diffChunks = [
  {
    id: 'hunk-dashboard',
    file: 'src/components/Dashboard.tsx',
    context: [`import { TileGrid } from './TileGrid';`, '', 'export function Dashboard() {'],
    removed: [`const tiles = ['Health', 'Budget'];`, 'return <div>{tiles}</div>;'],
    added: [`const tiles = ['Health', 'Budget', 'Spec', 'Tests'];`, 'return <TileGrid tiles={tiles} columns={4} />;'],
    note: 'Frontend Architect — Added missing summary tiles for the dashboard overview.',
  },
  {
    id: 'hunk-auth',
    file: 'src/lib/auth.ts',
    context: ['export function validateToken(token: string) {'],
    removed: ['return token.length > 0;'],
    added: ['return token.trim().length > 0 && token.startsWith(\'ey\');'],
    note: 'Backend Engineer — Reject empty tokens and malformed JWT payloads.',
  },
];

const prStatusColors = { open: 'bg-success/10 text-success', review: 'bg-warning/10 text-warning', merged: 'bg-info/10 text-info' };
const fileStatusColors: Record<string, string> = { M: 'text-warning', A: 'text-success', '🔒': 'text-info' };
const branchColors: Record<string, string> = { 'feature/dashboard': 'text-info', 'feature/auth': 'text-success', main: 'text-primary' };

export default function CodeVersioning() {
  const [tab, setTab] = useState<'editor' | 'diff' | 'git'>('git');
  const [selectedFile, setSelectedFile] = useState('src/components/Dashboard.tsx');
  const [selectedPrId, setSelectedPrId] = useState('#12');
  const [lockPanelOpen, setLockPanelOpen] = useState(true);
  const [diffMode, setDiffMode] = useState<'split' | 'unified'>('unified');
  const [decisions, setDecisions] = useState<Record<string, DiffDecision>>({});

  const selectedPr = pullRequests.find((pr) => pr.id === selectedPrId) ?? pullRequests[0];
  const visibleDiffs = diffChunks.filter((chunk) => chunk.file === selectedPr.diffFile);
  const activeCode = fileContents[selectedFile] ?? '// No content available for this file yet.';

  const decisionSummary = useMemo(() => {
    const accepted = Object.values(decisions).filter((decision) => decision === 'accepted').length;
    const rejected = Object.values(decisions).filter((decision) => decision === 'rejected').length;
    return { accepted, rejected };
  }, [decisions]);

  const selectPr = (pr: PullRequest) => {
    setSelectedPrId(pr.id);
    setSelectedFile(pr.focusFile);
    setTab(pr.status === 'merged' ? 'git' : 'diff');
  };

  return (
    <div className="flex h-full">
      <div className="w-72 border-r border-border flex flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-mono text-foreground">{selectedPr.id === '#12' ? 'feature/dashboard' : 'feature/auth'}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin p-2 text-xs">
          <FileTree items={fileTree} selectedFile={selectedFile} onSelect={setSelectedFile} />
        </div>

        <div className="border-t border-border">
          <div className="flex items-center justify-between px-3 py-2 text-micro text-muted-foreground font-semibold">
            <span>Pull Requests</span>
            <span>{decisionSummary.accepted} accepted / {decisionSummary.rejected} rejected</span>
          </div>
          {pullRequests.map((pr) => (
            <button
              key={pr.id}
              onClick={() => selectPr(pr)}
              className={cn('flex items-center gap-2 w-full px-3 py-2 hover:bg-surface-2 transition-colors text-left', selectedPrId === pr.id && 'bg-primary/10')}
            >
              <span className={cn('rounded-full px-1.5 py-0.5 text-micro', prStatusColors[pr.status])}>{pr.status}</span>
              <span className="text-xs truncate flex-1">{pr.title}</span>
              <span className="text-micro text-muted-foreground">{pr.id}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex items-center border-b border-border">
          <div className="flex">
            {(['editor', 'diff', 'git'] as const).map((item) => {
              const tabLabel = item === 'git' ? 'Git Graph' : item === 'editor' ? 'Editor' : 'Diff View';
              return (
                <button key={item} onClick={() => setTab(item)} className={cn('px-4 py-2 text-xs capitalize border-b-2 transition-colors', tab === item ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                  {tabLabel}
                </button>
              );
            })}
          </div>
          {tab === 'diff' && (
            <div className="ml-auto flex gap-1 mr-4">
              <button onClick={() => setDiffMode('unified')} className={cn('px-2 py-0.5 text-micro rounded', diffMode === 'unified' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>Unified</button>
              <button onClick={() => setDiffMode('split')} className={cn('px-2 py-0.5 text-micro rounded', diffMode === 'split' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>Split</button>
            </div>
          )}
          {tab === 'editor' && (
            <div className="ml-auto mr-4 flex items-center gap-2">
              <span className="text-micro text-muted-foreground">{selectedFile}</span>
              <span className="flex items-center gap-1 text-micro text-info"><Bot className="h-3 w-3" /> {selectedPr.author}</span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin">
          {tab === 'git' && (
            <div className="p-4 space-y-1 animate-fade-in">
              {(['current', 'previous'] as const).map((sessionLabel) => (
                <div key={sessionLabel} className="space-y-1">
                  <div className={cn('text-micro font-semibold mb-2 flex items-center gap-1', sessionLabel === 'current' ? 'text-primary' : 'text-muted-foreground')}>
                    <Clock className="h-3 w-3" />
                    {sessionLabel === 'current' ? 'Current Session' : 'Previous Session'}
                  </div>
                  {commits.filter((commit) => commit.session === sessionLabel).map((commit, index, arr) => (
                    <div key={commit.hash} className={cn('flex items-start gap-3 group', sessionLabel === 'previous' && 'opacity-70')}>
                      <div className="flex flex-col items-center">
                        <div className={cn('h-3 w-3 rounded-full border-2', index === 0 && sessionLabel === 'current' ? 'border-primary bg-primary/20' : 'border-border bg-surface-2')} />
                        {index < arr.length - 1 && <div className="w-px h-8 bg-border" />}
                      </div>
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{commit.message}</span>
                          <span className="text-micro font-mono text-muted-foreground">{commit.hash}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-micro text-muted-foreground">{commit.author}</span>
                          <span className="text-micro text-muted-foreground">•</span>
                          <span className="text-micro text-muted-foreground">{commit.time}</span>
                          <span className={cn('text-micro font-mono', branchColors[commit.branch] || 'text-info')}>{commit.branch}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'editor' && (
            <div className="p-4 animate-fade-in">
              <div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
                <div className="flex">
                  <div className="text-right pr-3 pl-3 py-3 text-micro font-mono text-muted-foreground/40 select-none border-r border-border bg-surface-3">
                    {activeCode.split('\n').map((_, index) => (
                      <div key={`line-${index}`} className="leading-relaxed">{index + 1}</div>
                    ))}
                  </div>
                  <pre className="p-3 text-xs font-mono text-foreground leading-relaxed flex-1 overflow-x-auto">
                    <code>{activeCode}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}

          {tab === 'diff' && (
            <div className="p-4 space-y-4 animate-fade-in">
              {visibleDiffs.map((chunk) => {
                const decision = decisions[chunk.id] ?? null;
                const decisionBorderIfRejected = decision === 'rejected' ? 'border-destructive/40' : 'border-border';
                const decisionBorder = decision === 'accepted' ? 'border-success/40' : decisionBorderIfRejected;
                return (
                  <div key={chunk.id} className={cn('rounded-lg border overflow-hidden', decisionBorder)}>
                    <div className="bg-surface-2 px-3 py-1.5 text-xs text-muted-foreground border-b border-border flex justify-between">
                      <span>{chunk.file}</span>
                      <span className="text-micro text-muted-foreground">{selectedPr.id}</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 bg-primary/5 border-b border-border">
                      <Bot className="h-3 w-3 text-primary" />
                      <span className="text-micro text-primary">{chunk.note}</span>
                    </div>
                    <div className="text-xs font-mono">
                      {chunk.context.map((line) => <div key={`ctx-${line}`} className="px-3 py-0.5 text-muted-foreground">{line || ' '}</div>)}
                      {diffMode === 'split' ? (
                        <div className="grid grid-cols-2">
                          <div className="border-r border-border">
                            {chunk.removed.map((line) => <div key={`left-${line}`} className="bg-destructive/5 px-3 py-0.5 text-destructive/80">- {line}</div>)}
                          </div>
                          <div>
                            {chunk.added.map((line) => <div key={`right-${line}`} className="bg-success/5 px-3 py-0.5 text-success/80">+ {line}</div>)}
                          </div>
                        </div>
                      ) : (
                        <>
                          {chunk.removed.map((line) => <div key={`rm-${line}`} className="bg-destructive/5 px-3 py-0.5 text-destructive/80">- {line}</div>)}
                          {chunk.added.map((line) => <div key={`add-${line}`} className="bg-success/5 px-3 py-0.5 text-success/80">+ {line}</div>)}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-surface-2">
                      <button onClick={() => setDecisions((current) => ({ ...current, [chunk.id]: current[chunk.id] === 'accepted' ? null : 'accepted' }))} className={cn('flex items-center gap-1 text-micro hover:underline', decision === 'accepted' ? 'text-success' : 'text-muted-foreground')}>
                        <Check className="h-3 w-3" />
                        Accept
                      </button>
                      <button onClick={() => setDecisions((current) => ({ ...current, [chunk.id]: current[chunk.id] === 'rejected' ? null : 'rejected' }))} className={cn('flex items-center gap-1 text-micro hover:underline', decision === 'rejected' ? 'text-destructive' : 'text-muted-foreground')}>
                        <X className="h-3 w-3" />
                        Reject
                      </button>
                      {decision && <span className="ml-auto text-micro text-muted-foreground capitalize">{decision}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border">
          <button onClick={() => setLockPanelOpen((open) => !open)} className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            {lockPanelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Lock className="h-3 w-3" /> Lock Activity ({lockRows.length} active)
          </button>
          <AnimatePresence>
            {lockPanelOpen && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-t border-border text-muted-foreground bg-surface-2">
                      <th className="text-left px-4 py-1.5 font-medium">File</th>
                      <th className="text-left px-4 py-1.5 font-medium">Function</th>
                      <th className="text-left px-4 py-1.5 font-medium">Agent</th>
                      <th className="text-left px-4 py-1.5 font-medium">Duration</th>
                      <th className="text-left px-4 py-1.5 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lockRows.map((row) => (
                      <tr key={`${row.file}-${row.function}`} className="border-t border-border hover:bg-surface-2/50">
                        <td className="px-4 py-1.5 font-mono text-muted-foreground">{row.file}</td>
                        <td className="px-4 py-1.5 font-mono">{row.function}</td>
                        <td className="px-4 py-1.5">{row.agent}</td>
                        <td className="px-4 py-1.5 font-mono text-muted-foreground">{row.duration}</td>
                        <td className="px-4 py-1.5"><span className={cn('text-micro px-1.5 py-0.5 rounded', row.type === 'exclusive' ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info')}>{row.type}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function FileTree({
  items,
  selectedFile,
  onSelect,
  depth = 0,
}: {
  readonly items: FileNode[];
  readonly selectedFile: string;
  readonly onSelect: (path: string) => void;
  readonly depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <>
      {items.map((item) => {
        const folderChevron = collapsed[item.path] ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />;
        const chevronOrSpacer = item.type === 'folder' ? folderChevron : <span className="w-3" />;
        const folderOrFileIcon = item.type === 'folder' ? <FolderOpen className="h-3.5 w-3.5 text-primary/60" /> : <File className="h-3.5 w-3.5 text-muted-foreground" />;
        return (
        <div key={item.path}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => item.type === 'folder' ? setCollapsed((current) => ({ ...current, [item.path]: !current[item.path] })) : onSelect(item.path)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { item.type === 'folder' ? setCollapsed((current) => ({ ...current, [item.path]: !current[item.path] })) : onSelect(item.path); } }}
            className={cn('flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2 cursor-pointer transition-colors', item.path === selectedFile && 'bg-primary/10 text-primary')}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {chevronOrSpacer}
            {folderOrFileIcon}
            <span className="flex-1 truncate">{item.name}</span>
            {item.status && <span className={cn('text-micro font-bold', fileStatusColors[item.status] || 'text-muted-foreground')}>{item.status}</span>}
          </div>
          {item.children && !collapsed[item.path] && <FileTree items={item.children} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} />}
        </div>
        );
      })}
    </>
  );
}
