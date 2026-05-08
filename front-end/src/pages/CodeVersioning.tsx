import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { useHiveData } from '@/api/queries/useHiveData';
import { useInitWorkspace, useWorkspaceInfo } from '@/api/tools';
import { toast } from 'sonner';
import { BranchSelector } from '@/components/layout/code-versioning/BranchSelector';
import { WorkingTreeStatus } from '@/components/layout/code-versioning/WorkingTreeStatus';
import { GitFileTree } from '@/components/layout/code-versioning/GitFileTree';
import { GitOperationsPanel } from '@/components/layout/code-versioning/GitOperationsPanel';
import { AlertCircle, Terminal, HardDrive } from 'lucide-react';

export default function CodeVersioning() {
  const { activeProject } = useHiveData();
  const workspaceQuery = useWorkspaceInfo(activeProject?.id ?? null);
  const initWorkspace = useInitWorkspace(activeProject?.id ?? null);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [isOperating, setIsOperating] = useState(false);
  const [opProgress, setOpProgress] = useState<number | undefined>(undefined);

  // Mock data for initial UI
  const branches = ['main', 'feature/auth-provider', 'fix/api-latency', 'chore/refactor-db'];
  const [files, setFiles] = useState([
    { path: 'back-end/src/main.rs', status: 'modified', staged: true },
    { path: 'front-end/src/App.tsx', status: 'modified', staged: false },
    { path: 'front-end/src/api/git.ts', status: 'added', staged: true },
    { path: 'GEMINI.md', status: 'modified', staged: true },
    { path: 'README.md', status: 'deleted', staged: false },
  ]);

  const stagedCount = files.filter(f => f.staged).length;
  const modifiedCount = files.filter(f => !f.staged).length;

  const handleCommit = async () => {
    setIsOperating(true);
    setOpProgress(0);
    // Simulate commit
    for (let i = 0; i <= 100; i += 20) {
      setOpProgress(i);
      await new Promise(r => setTimeout(r, 150));
    }
    toast.success('Changes committed successfully');
    setCommitMessage('');
    setIsOperating(false);
    setOpProgress(undefined);
  };

  const handlePush = async () => {
    setIsOperating(true);
    // Simulate push
    await new Promise(r => setTimeout(r, 1000));
    toast.success('Pushed to main');
    setIsOperating(false);
  };

  const handleSync = async () => {
    setIsOperating(true);
    // Simulate sync
    await new Promise(r => setTimeout(r, 1200));
    toast.success('Workspace synchronized');
    setIsOperating(false);
  };

  const toggleStage = (path: string) => {
    setFiles(prev => prev.map(f => f.path === path ? { ...f, staged: !f.staged } : f));
  };

  const isUninitialized = workspaceQuery.data?.status === 'missing' || !activeProject;

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar: File Tree & Controls */}
      <div className="w-80 border-r border-border flex flex-col bg-surface-1">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-tight text-muted-foreground">Source Control</h2>
            <BranchSelector currentBranch={currentBranch} branches={branches} onBranchChange={setCurrentBranch} />
          </div>
          <WorkingTreeStatus stagedFiles={stagedCount} modifiedFiles={modifiedCount} insertions={124} deletions={18} />
        </div>

        <GitFileTree files={files as any} selectedFile={selectedFile} onSelectFile={setSelectedFile} onToggleStage={toggleStage} />

        <GitOperationsPanel
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onCommit={handleCommit}
          onPush={handlePush}
          onSync={handleSync}
          isPending={isOperating}
          progress={opProgress}
        />
      </div>

      {/* Main Content: Editor or Empty State */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {isUninitialized ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="p-4 rounded-full bg-surface-2 border border-border">
              <HardDrive className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-bold">Workspace Not Initialized</h2>
              <p className="text-sm text-muted-foreground">This project needs a local workspace initialized before you can manage source code and git operations.</p>
            </div>
            <button
              onClick={() => initWorkspace.mutateAsync()}
              disabled={initWorkspace.isPending || !activeProject}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {initWorkspace.isPending ? 'Initializing...' : 'Initialize Workspace'}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="h-10 border-b border-border flex items-center px-4 justify-between bg-surface-1">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-primary" />
                <span className="text-xs font-mono truncate max-w-[400px]">{selectedFile ?? 'Select a file'}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-success" /> Connected to Backend
                </div>
              </div>
            </div>

            <div className="flex-1 relative overflow-hidden">
              {selectedFile ? (
                <Editor
                  height="100%"
                  defaultLanguage="rust"
                  theme="vs-dark"
                  path={selectedFile}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 16 },
                  }}
                  value={`// Content for ${selectedFile}\n\nfn main() {\n    println!(\"Hello from Hive!\");\n}`}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground bg-surface-1/30">
                  <div className="text-center space-y-3">
                    <Terminal className="h-10 w-10 mx-auto opacity-20" />
                    <p className="text-sm">Select a file from the tree to view its contents.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
