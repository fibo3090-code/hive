import { useState } from 'react';
import { cn } from '@/lib/utils';
import { GitBranch, GitCommit, File, FolderOpen, Lock, Check, X, Eye, ChevronDown, ChevronRight, Bot, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const mockFiles = [
  { name: 'src', type: 'folder', children: [
    { name: 'components', type: 'folder', children: [
      { name: 'Dashboard.tsx', type: 'file', status: 'M' as const },
      { name: 'Sidebar.tsx', type: 'file', status: 'M' as const },
      { name: 'AgentCard.tsx', type: 'file', status: 'A' as const },
      { name: 'StatusDot.tsx', type: 'file', status: 'A' as const },
    ]},
    { name: 'lib', type: 'folder', children: [
      { name: 'api.ts', type: 'file', status: 'M' as const },
      { name: 'auth.ts', type: 'file', status: '🔒' as const },
      { name: 'types.ts', type: 'file', status: 'A' as const },
    ]},
    { name: 'hooks', type: 'folder', children: [
      { name: 'useAgents.ts', type: 'file', status: 'A' as const },
    ]},
    { name: 'main.tsx', type: 'file', status: undefined },
  ]},
  { name: 'tests', type: 'folder', children: [
    { name: 'auth.test.ts', type: 'file', status: 'A' as const },
    { name: 'api.test.ts', type: 'file', status: 'M' as const },
  ]},
  { name: 'package.json', type: 'file', status: 'M' as const },
  { name: 'tsconfig.json', type: 'file', status: undefined },
];

const mockCommits = [
  { hash: 'a3f2c1d', message: 'feat: implement dashboard summary tiles', author: 'Frontend Architect', time: '5 min ago', branch: 'feature/dashboard', session: 'current' },
  { hash: 'b8e4f2a', message: 'feat: add auth middleware with JWT validation', author: 'Backend Engineer', time: '12 min ago', branch: 'feature/auth', session: 'current' },
  { hash: 'c1d5e3b', message: 'test: add integration tests for auth flow', author: 'QA Sentinel', time: '18 min ago', branch: 'feature/auth', session: 'current' },
  { hash: 'd4f6a2c', message: 'refactor: optimize database query patterns', author: 'Backend Engineer', time: '25 min ago', branch: 'main', session: 'previous' },
  { hash: 'e7b3d1a', message: 'docs: update API endpoint documentation', author: 'Doc Writer', time: '32 min ago', branch: 'docs/api', session: 'previous' },
  { hash: 'f2a8c3d', message: 'fix: resolve WebSocket timeout issues', author: 'Backend Engineer', time: '45 min ago', branch: 'main', session: 'previous' },
];

const mockPRs = [
  { id: '#12', title: 'Dashboard components', status: 'open' as const, author: 'Frontend Architect', additions: 342, deletions: 18, reviewers: ['QA Sentinel'] },
  { id: '#11', title: 'Auth middleware', status: 'review' as const, author: 'Backend Engineer', additions: 156, deletions: 23, reviewers: ['Security Auditor', 'QA Sentinel'] },
  { id: '#10', title: 'Test coverage boost', status: 'merged' as const, author: 'QA Sentinel', additions: 289, deletions: 12, reviewers: [] },
];

const mockLocks = [
  { file: 'src/lib/auth.ts', function: 'validateToken()', agent: 'Backend Engineer', duration: '4m 23s', type: 'exclusive' },
  { file: 'src/lib/api.ts', function: 'fetchData()', agent: 'Frontend Architect', duration: '1m 12s', type: 'shared' },
];

const mockDiffChunks = [
  { file: 'src/components/Dashboard.tsx', hunks: [
    { removed: ['const tiles = [\'Health\', \'Budget\'];', 'return <div>{tiles}</div>;'],
      added: ['const tiles = [\'Health\', \'Budget\', \'Spec\', \'Tests\', \'Agents\'];', 'return <TileGrid tiles={tiles} columns={5} />;'],
      context: ['import { TileGrid } from \'./TileGrid\';', '', 'export function Dashboard() {'],
      agentNote: 'Frontend Architect — Added remaining summary tiles per spec §4.2',
    },
    { removed: ['// TODO: add error handling'],
      added: ['try {', '  const data = await fetchDashboardData();', '  return data;', '} catch (error) {', '  handleError(error);', '}'],
      context: ['async function loadData() {'],
      agentNote: 'Frontend Architect — Replaced TODO with proper error handling',
    },
  ]},
];

const editorCode = `// Dashboard.tsx — Agent-authored code
// Author: Frontend Architect (Claude 3.5 Sonnet)
// Last modified: 5 min ago

import React from 'react';
import { TileGrid } from './TileGrid';
import { AgentCard } from './AgentCard';

interface DashboardProps {
  agents: Agent[];
  session: SessionInfo;
}

export function Dashboard({ agents, session }: DashboardProps) {
  const activeAgents = agents.filter(a => a.status === 'working');
  const healthScore = calculateHealthScore(agents);
  
  const tiles = [
    { label: 'Health', value: healthScore, icon: Heart },
    { label: 'Budget', value: session.budgetUsed, icon: DollarSign },
    { label: 'Spec', value: session.specCompletion, icon: FileCheck },
    { label: 'Tests', value: session.testCoverage, icon: TestTube2 },
    { label: 'Agents', value: activeAgents.length, icon: Bot },
  ];

  return (
    <div className="p-6 space-y-6">
      <TileGrid tiles={tiles} columns={5} />
      <div className="grid grid-cols-3 gap-6">
        {agents.map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}`;

const statusColors: Record<string, string> = { M: 'text-warning', A: 'text-success', D: 'text-destructive', '🔒': 'text-info', '⚠': 'text-warning' };
const prStatusColors = { open: 'bg-success/10 text-success', review: 'bg-warning/10 text-warning', merged: 'bg-info/10 text-info' };
const branchColors: Record<string, string> = { 'feature/dashboard': 'text-info', 'feature/auth': 'text-success', 'main': 'text-primary', 'docs/api': 'text-warning' };

export default function CodeVersioning() {
  const [tab, setTab] = useState<'editor' | 'diff' | 'git'>('git');
  const [selectedFile, setSelectedFile] = useState('Dashboard.tsx');
  const [lockPanelOpen, setLockPanelOpen] = useState(true);
  const [diffMode, setDiffMode] = useState<'split' | 'unified'>('unified');

  return (
    <div className="flex h-full">
      {/* Left: file tree */}
      <div className="w-64 border-r border-border flex flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-mono text-foreground">feature/dashboard</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin p-2 text-xs">
          <FileTree items={mockFiles} depth={0} selectedFile={selectedFile} onSelect={setSelectedFile} />
        </div>

        <div className="border-t border-border">
          <div className="px-3 py-2 text-micro text-muted-foreground font-semibold">Pull Requests</div>
          {mockPRs.map((pr) => (
            <div key={pr.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 cursor-pointer transition-colors">
              <span className={cn('rounded-full px-1.5 py-0.5 text-micro', prStatusColors[pr.status])}>{pr.status}</span>
              <span className="text-xs truncate flex-1">{pr.title}</span>
              <span className="text-micro text-muted-foreground">{pr.id}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border">
          <div className="flex">
            {(['editor', 'diff', 'git'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={cn('px-4 py-2 text-xs capitalize border-b-2 transition-colors', tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {t === 'git' ? 'Git Graph' : t === 'editor' ? 'Editor' : 'Diff View'}
              </button>
            ))}
          </div>
          {tab === 'diff' && (
            <div className="ml-auto flex gap-1 mr-4">
              <button onClick={() => setDiffMode('unified')} className={cn('px-2 py-0.5 text-micro rounded', diffMode === 'unified' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>Unified</button>
              <button onClick={() => setDiffMode('split')} className={cn('px-2 py-0.5 text-micro rounded', diffMode === 'split' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>Split</button>
            </div>
          )}
          {tab === 'editor' && (
            <div className="ml-auto mr-4 flex items-center gap-2">
              <span className="text-micro text-muted-foreground">Dashboard.tsx</span>
              <span className="flex items-center gap-1 text-micro text-info"><Bot className="h-3 w-3" /> Frontend Architect</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {tab === 'git' && (
            <div className="p-4 space-y-1 animate-fade-in">
              {/* Group by session */}
              <div className="text-micro text-primary font-semibold mb-2 flex items-center gap-1"><Clock className="h-3 w-3" /> Current Session</div>
              {mockCommits.filter(c => c.session === 'current').map((commit, i, arr) => (
                <div key={commit.hash} className="flex items-start gap-3 group">
                  <div className="flex flex-col items-center">
                    <div className={cn('h-3 w-3 rounded-full border-2', i === 0 ? 'border-primary bg-primary/20' : 'border-border bg-surface-2')} />
                    {i < arr.length - 1 && <div className="w-px h-8 bg-border" />}
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

              <div className="text-micro text-muted-foreground font-semibold mb-2 mt-4 flex items-center gap-1"><Clock className="h-3 w-3" /> Previous Session</div>
              {mockCommits.filter(c => c.session === 'previous').map((commit, i, arr) => (
                <div key={commit.hash} className="flex items-start gap-3 group opacity-70">
                  <div className="flex flex-col items-center">
                    <div className="h-3 w-3 rounded-full border-2 border-border bg-surface-2" />
                    {i < arr.length - 1 && <div className="w-px h-8 bg-border" />}
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
          )}

          {tab === 'editor' && (
            <div className="p-4 animate-fade-in">
              <div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
                <div className="flex">
                  {/* Line numbers */}
                  <div className="text-right pr-3 pl-3 py-3 text-micro font-mono text-muted-foreground/40 select-none border-r border-border bg-surface-3">
                    {editorCode.split('\n').map((_, i) => (
                      <div key={i} className={cn('leading-relaxed', [4,5,6,14,15,16,17,18,19,20].includes(i) ? 'bg-info/5' : '')}>{i + 1}</div>
                    ))}
                  </div>
                  {/* Code */}
                  <pre className="p-3 text-xs font-mono text-foreground leading-relaxed flex-1 overflow-x-auto">
                    <code>{editorCode}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}

          {tab === 'diff' && (
            <div className="p-4 space-y-4 animate-fade-in">
              {mockDiffChunks.map((chunk, ci) => (
                <div key={ci} className="rounded-lg border border-border overflow-hidden">
                  <div className="bg-surface-2 px-3 py-1.5 text-xs text-muted-foreground border-b border-border flex justify-between">
                    <span>{chunk.file}</span>
                  </div>
                  {chunk.hunks.map((hunk, hi) => (
                    <div key={hi}>
                      {hunk.agentNote && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-primary/5 border-b border-border">
                          <Bot className="h-3 w-3 text-primary" />
                          <span className="text-micro text-primary">{hunk.agentNote}</span>
                        </div>
                      )}
                      <div className="text-xs font-mono">
                        {hunk.context.map((line, i) => (
                          <div key={`c${i}`} className="px-3 py-0.5 text-muted-foreground">{line || ' '}</div>
                        ))}
                        {hunk.removed.map((line, i) => (
                          <div key={`r${i}`} className="bg-destructive/5 px-3 py-0.5 text-destructive/80">- {line}</div>
                        ))}
                        {hunk.added.map((line, i) => (
                          <div key={`a${i}`} className="bg-success/5 px-3 py-0.5 text-success/80">+ {line}</div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-surface-2">
                        <button className="flex items-center gap-1 text-micro text-success hover:underline"><Check className="h-3 w-3" /> Accept</button>
                        <button className="flex items-center gap-1 text-micro text-destructive hover:underline"><X className="h-3 w-3" /> Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lock Activity Panel */}
        <div className="border-t border-border">
          <button onClick={() => setLockPanelOpen(!lockPanelOpen)} className="flex items-center gap-2 w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            {lockPanelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Lock className="h-3 w-3" /> Lock Activity ({mockLocks.length} active)
          </button>
          <AnimatePresence>
            {lockPanelOpen && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="border-t border-border text-muted-foreground bg-surface-2">
                    <th className="text-left px-4 py-1.5 font-medium">File</th>
                    <th className="text-left px-4 py-1.5 font-medium">Function</th>
                    <th className="text-left px-4 py-1.5 font-medium">Agent</th>
                    <th className="text-left px-4 py-1.5 font-medium">Duration</th>
                    <th className="text-left px-4 py-1.5 font-medium">Type</th>
                  </tr></thead>
                  <tbody>
                    {mockLocks.map((lock, i) => (
                      <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                        <td className="px-4 py-1.5 font-mono text-muted-foreground">{lock.file}</td>
                        <td className="px-4 py-1.5 font-mono">{lock.function}</td>
                        <td className="px-4 py-1.5">{lock.agent}</td>
                        <td className="px-4 py-1.5 font-mono text-muted-foreground">{lock.duration}</td>
                        <td className="px-4 py-1.5"><span className={cn('text-micro px-1.5 py-0.5 rounded', lock.type === 'exclusive' ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info')}>{lock.type}</span></td>
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

function FileTree({ items, depth, selectedFile, onSelect }: { items: any[]; depth: number; selectedFile: string; onSelect: (name: string) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <>
      {items.map((item: any) => (
        <div key={item.name}>
          <div
            onClick={() => item.type === 'folder' ? setCollapsed(c => ({ ...c, [item.name]: !c[item.name] })) : onSelect(item.name)}
            className={cn('flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2 cursor-pointer transition-colors', item.name === selectedFile && 'bg-primary/10 text-primary')}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {item.type === 'folder' ? (
              collapsed[item.name] ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : null}
            {item.type === 'folder' ? <FolderOpen className="h-3.5 w-3.5 text-primary/60" /> : <File className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="flex-1 truncate">{item.name}</span>
            {item.status && <span className={cn('text-micro font-bold', statusColors[item.status] || 'text-muted-foreground')}>{item.status}</span>}
          </div>
          {item.children && !collapsed[item.name] && <FileTree items={item.children} depth={depth + 1} selectedFile={selectedFile} onSelect={onSelect} />}
        </div>
      ))}
    </>
  );
}
