import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useHiveData } from '@/api/queries/useHiveData';
import { useInitWorkspace, useWorkspaceInfo } from '@/api/tools';
import {
  useGitStatus,
  useGitBranches,
  useGitFile,
  useCommitGit,
  useCheckoutGitBranch,
  useRestoreGit,
  useInitGitRepo,
} from '@/api/git';
import { toast } from 'sonner';
import { BranchSelector } from '@/components/layout/code-versioning/BranchSelector';
import { WorkingTreeStatus } from '@/components/layout/code-versioning/WorkingTreeStatus';
import { GitFileTree, type GitFileEntry } from '@/components/layout/code-versioning/GitFileTree';
import { GitOperationsPanel } from '@/components/layout/code-versioning/GitOperationsPanel';
import { FileCode, Terminal, HardDrive } from 'lucide-react';

function classifyStatus(index: string, worktree: string): GitFileEntry['status'] {
  const flags = `${index}${worktree}`;
  if (flags.includes('D')) return 'deleted';
  if (flags.includes('A') || flags.includes('?')) return 'added';
  return 'modified';
}

function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'rs': return 'rust';
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': case 'mjs': case 'cjs': return 'javascript';
    case 'json': return 'json';
    case 'md': return 'markdown';
    case 'toml': return 'toml';
    case 'yml': case 'yaml': return 'yaml';
    case 'css': return 'css';
    case 'html': return 'html';
    case 'sh': return 'shell';
    case 'py': return 'python';
    default: return 'plaintext';
  }
}

export default function CodeVersioning() {
  const { activeProject } = useHiveData();
  const projectId = activeProject?.id ?? null;

  const workspaceQuery = useWorkspaceInfo(projectId);
  const initWorkspace = useInitWorkspace(projectId);
  const initGitRepo = useInitGitRepo(projectId);

  const statusQuery = useGitStatus(projectId);
  const branchesQuery = useGitBranches(projectId);
  const commitMutation = useCommitGit(projectId);
  const checkoutMutation = useCheckoutGitBranch(projectId);
  const restoreMutation = useRestoreGit(projectId);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [stagedOverrides, setStagedOverrides] = useState<Record<string, boolean>>({});

  const fileQuery = useGitFile(projectId, selectedFile);

  const files: GitFileEntry[] = useMemo(() => {
    const entries = statusQuery.data ?? [];
    return entries.map((e) => {
      const inferredStaged = e.indexStatus.trim() !== '' && e.indexStatus !== '?';
      return {
        path: e.path,
        status: classifyStatus(e.indexStatus, e.worktreeStatus),
        staged: stagedOverrides[e.path] ?? inferredStaged,
      };
    });
  }, [statusQuery.data, stagedOverrides]);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const branchNames = (branchesQuery.data ?? []).map((b) => b.name);
  const currentBranch = (branchesQuery.data ?? []).find((b) => b.current)?.name ?? 'HEAD';

  const isOperating =
    commitMutation.isPending || checkoutMutation.isPending || restoreMutation.isPending;

  const isUninitialized =
    workspaceQuery.data?.status === 'missing' || !projectId || statusQuery.isError;

  const handleBranchChange = (name: string) => {
    if (name === currentBranch) return;
    checkoutMutation.mutate(
      { name },
      {
        onSuccess: () => toast.success(`Checked out ${name}`),
        onError: (err) => toast.error(`Checkout failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  const handleCommit = () => {
    const paths = stagedFiles.map((f) => f.path);
    commitMutation.mutate(
      { message: commitMessage.trim(), paths: paths.length ? paths : undefined },
      {
        onSuccess: (c) => {
          toast.success(`Committed ${c.shortHash}`);
          setCommitMessage('');
          setStagedOverrides({});
        },
        onError: (err) => toast.error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  const handleRefresh = () => {
    statusQuery.refetch();
    branchesQuery.refetch();
    if (selectedFile) fileQuery.refetch();
  };

  const handleDiscard = () => {
    const paths = unstagedFiles.map((f) => f.path);
    if (paths.length === 0) return;
    if (!window.confirm(`Discard local changes to ${paths.length} file(s)? This cannot be undone.`)) return;
    restoreMutation.mutate(paths, {
      onSuccess: () => toast.success('Discarded local changes'),
      onError: (err) => toast.error(`Discard failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  const toggleStage = (path: string) => {
    setStagedOverrides((prev) => {
      const current = files.find((f) => f.path === path)?.staged ?? false;
      return { ...prev, [path]: !current };
    });
  };

  const editorValue = fileQuery.data?.binary
    ? '// Binary file — preview not available.'
    : fileQuery.data?.content ?? (fileQuery.isFetching ? '// Loading…' : '// File not found in the current tree (it may be untracked or deleted).');

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar: File Tree & Controls */}
      <div className="w-80 border-r border-border flex flex-col bg-surface-1">
        <div className="p-4 border-b border-border space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-tight text-muted-foreground">Source Control</h2>
            <BranchSelector currentBranch={currentBranch} branches={branchNames} onBranchChange={handleBranchChange} />
          </div>
          <WorkingTreeStatus stagedFiles={stagedFiles.length} modifiedFiles={unstagedFiles.length} insertions={0} deletions={0} />
        </div>

        {files.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {statusQuery.isFetching ? 'Loading status…' : 'Working tree clean.'}
          </div>
        ) : (
          <GitFileTree files={files} selectedFile={selectedFile} onSelectFile={setSelectedFile} onToggleStage={toggleStage} />
        )}

        <GitOperationsPanel
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onCommit={handleCommit}
          onRefresh={handleRefresh}
          onDiscard={handleDiscard}
          canCommit={stagedFiles.length > 0}
          canDiscard={unstagedFiles.length > 0}
          isPending={isOperating}
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
              <h2 className="text-xl font-bold">Workspace Not Ready</h2>
              <p className="text-sm text-muted-foreground">
                This project needs a local workspace with an initialized git repository before you can manage source code.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => initWorkspace.mutateAsync().then(() => toast.success('Workspace initialized')).catch((e) => toast.error(String(e)))}
                disabled={initWorkspace.isPending || !projectId}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-md font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {initWorkspace.isPending ? 'Initializing…' : 'Initialize Workspace'}
              </button>
              <button
                onClick={() => initGitRepo.mutateAsync().then(() => toast.success('Git repository initialized')).catch((e) => toast.error(String(e)))}
                disabled={initGitRepo.isPending || !projectId}
                className="px-6 py-2 border border-border rounded-md font-semibold hover:bg-surface-2 transition-colors disabled:opacity-50"
              >
                {initGitRepo.isPending ? 'Initializing…' : 'git init'}
              </button>
            </div>
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
                  <div className={`h-1.5 w-1.5 rounded-full ${statusQuery.isError ? 'bg-destructive' : 'bg-success'}`} />
                  {statusQuery.isError ? 'Backend error' : 'Live from git'}
                </div>
              </div>
            </div>

            <div className="flex-1 relative overflow-hidden">
              {selectedFile ? (
                <Editor
                  height="100%"
                  language={languageForPath(selectedFile)}
                  theme="vs-dark"
                  path={selectedFile}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 16 },
                  }}
                  value={editorValue}
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
