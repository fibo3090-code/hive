import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { cn } from '@/lib/utils';
import { useHiveData } from '@/api/queries/useHiveData';
import { useInitWorkspace, useWorkspaceInfo } from '@/api/tools';
import {
  useCheckoutGitBranch,
  useCommitGit,
  useConnectGitHub,
  useCreateGitBranch,
  useCreateGitHubPull,
  useGitBranches,
  useGitDiff,
  useGitFile,
  useGitHubPulls,
  useGitHubStatus,
  useGitLog,
  useGitStatus,
  useGitTree,
  useInitGitRepo,
  useRestoreGit,
  type GitTreeEntry,
} from '@/api/git';
import { GitBranch, File, FolderOpen, X, ChevronDown, ChevronRight, Github, RefreshCw, Plus } from 'lucide-react';
import { toast } from 'sonner';

type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

function buildTree(entries: GitTreeEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let nodes = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = nodes.find((candidate) => candidate.path === currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: isLeaf ? 'file' : 'folder',
          children: isLeaf ? undefined : [],
        };
        nodes.push(node);
      }
      if (!isLeaf) {
        node.children ??= [];
        nodes = node.children;
      }
    });
  }

  const normalize = (nodes: TreeNode[]): TreeNode[] => nodes
    .map((node) => ({
      ...node,
      children: node.children ? normalize(node.children) : undefined,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return normalize(root);
}

function FileTree({
  items,
  selectedFile,
  onSelect,
}: {
  readonly items: TreeNode[];
  readonly selectedFile: string | null;
  readonly onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const isOpen = open[item.path] ?? true;
        if (item.type === 'folder') {
          return (
            <div key={item.path}>
              <button
                onClick={() => setOpen((current) => ({ ...current, [item.path]: !isOpen }))}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <FolderOpen className="h-3.5 w-3.5" />
                <span>{item.name}</span>
              </button>
              {isOpen && item.children && (
                <div className="ml-4">
                  <FileTree items={item.children} selectedFile={selectedFile} onSelect={onSelect} />
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={item.path}
            onClick={() => onSelect(item.path)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface-2',
              selectedFile === item.path ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
          >
            <File className="h-3.5 w-3.5" />
            <span className="truncate">{item.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function CodeVersioning() {
  const { activeProject } = useHiveData();
  const projectId = activeProject?.id ?? null;
  const workspaceQuery = useWorkspaceInfo(projectId);
  const initWorkspace = useInitWorkspace(projectId);
  const initGitRepo = useInitGitRepo(projectId);
  const branchesQuery = useGitBranches(projectId);
  const logQuery = useGitLog(projectId);
  const statusQuery = useGitStatus(projectId);
  const treeQuery = useGitTree(projectId, 'HEAD');
  const githubStatusQuery = useGitHubStatus(projectId);
  const pullsQuery = useGitHubPulls(projectId);
  const createBranch = useCreateGitBranch(projectId);
  const checkoutBranch = useCheckoutGitBranch(projectId);
  const commitMutation = useCommitGit(projectId);
  const restoreMutation = useRestoreGit(projectId);
  const connectGitHub = useConnectGitHub(projectId);
  const createPull = useCreateGitHubPull(projectId);

  const [tab, setTab] = useState<'editor' | 'diff' | 'git'>('git');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<string>('WORKTREE');
  const [newBranch, setNewBranch] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prHead, setPrHead] = useState('');
  const [prBase, setPrBase] = useState('main');

  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const commits = useMemo(() => logQuery.data ?? [], [logQuery.data]);
  const statuses = useMemo(() => statusQuery.data ?? [], [statusQuery.data]);
  const tree = useMemo(() => buildTree(treeQuery.data ?? []), [treeQuery.data]);
  const diffQuery = useGitDiff(projectId, selectedRef);
  const fileQuery = useGitFile(projectId, selectedFile, selectedRef === 'WORKTREE' ? 'HEAD' : selectedRef);

  const statusMap = useMemo(() => Object.fromEntries(statuses.map((entry) => [entry.path, entry])), [statuses]);
  const currentBranch = branches.find((branch) => branch.current)?.name ?? 'main';

  const ensureWorkspaceAndRepo = async () => {
    try {
      if (workspaceQuery.data?.status !== 'ready') {
        await initWorkspace.mutateAsync();
      }
      await initGitRepo.mutateAsync();
      toast.success('Workspace and git repo ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to initialize git');
    }
  };

  const doCreateBranch = async () => {
    if (!newBranch.trim()) return;
    try {
      await createBranch.mutateAsync(newBranch.trim());
      await checkoutBranch.mutateAsync({ name: newBranch.trim() });
      setNewBranch('');
      toast.success('Branch created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create branch');
    }
  };

  const doCommit = async () => {
    if (!commitMessage.trim()) return;
    try {
      await commitMutation.mutateAsync({ message: commitMessage.trim() });
      setCommitMessage('');
      setSelectedRef('WORKTREE');
      toast.success('Changes committed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Commit failed');
    }
  };

  const restorePath = async (path: string) => {
    try {
      await restoreMutation.mutateAsync([path]);
      toast.success(`Restored ${path}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Restore failed');
    }
  };

  const connectRepo = async () => {
    try {
      const status = await connectGitHub.mutateAsync({ token: githubToken.trim(), owner: githubOwner.trim(), repo: githubRepo.trim() });
      setPrBase(status.defaultBranch ?? 'main');
      setGithubToken('');
      toast.success('GitHub connected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'GitHub connect failed');
    }
  };

  const createPr = async () => {
    try {
      await createPull.mutateAsync({ title: prTitle.trim(), head: prHead.trim(), base: prBase.trim(), body: `Created from HIVE on ${currentBranch}` });
      setPrTitle('');
      toast.success('Pull request created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create pull request');
    }
  };

  if (!projectId) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Select a project to open code versioning.</div>;
  }

  const repoReady = workspaceQuery.data?.status === 'ready';

  return (
    <div className="flex h-full">
      <div className="w-80 border-r border-border flex flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          <select
            value={currentBranch}
            onChange={(event) => {
              void checkoutBranch.mutateAsync({ name: event.target.value });
            }}
            className="flex-1 bg-transparent text-xs outline-none"
          >
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>{branch.name}</option>
            ))}
          </select>
          <button onClick={() => void ensureWorkspaceAndRepo()} className="rounded border border-border p-1 text-muted-foreground hover:text-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {!repoReady ? (
          <div className="p-4 text-xs text-muted-foreground space-y-3">
            <p>The active project does not have a workspace yet.</p>
            <button onClick={() => void ensureWorkspaceAndRepo()} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground hover:bg-primary/90">
              Initialize workspace
            </button>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border space-y-2">
              <div className="flex gap-2">
                <input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature/module-synth" className="h-8 flex-1 rounded-md border border-border bg-surface-2 px-3 text-xs" />
                <button onClick={() => void doCreateBranch()} className="rounded-md border border-border px-3 text-xs text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="rounded-md border border-border bg-surface-2 p-2">
                <div className="mb-2 text-micro font-semibold text-muted-foreground">Working Tree</div>
                <div className="space-y-1 max-h-40 overflow-auto scrollbar-thin">
                  {statuses.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No local changes.</div>
                  ) : statuses.map((entry) => (
                    <div key={entry.path} className="flex items-center gap-2 text-xs">
                      <button onClick={() => { setSelectedRef('WORKTREE'); setSelectedFile(entry.path); setTab('diff'); }} className="flex-1 truncate text-left hover:text-foreground">
                        {entry.path}
                      </button>
                      <span className="font-mono text-micro text-warning">{entry.indexStatus}{entry.worktreeStatus}</span>
                      <button onClick={() => void restorePath(entry.path)} className="rounded border border-border px-2 py-0.5 text-micro text-muted-foreground hover:text-foreground">
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto scrollbar-thin p-2 text-xs">
              <FileTree items={tree} selectedFile={selectedFile} onSelect={(path) => { setSelectedFile(path); setTab('editor'); }} />
            </div>

            <div className="border-t border-border p-3 space-y-3">
              <div>
                <div className="mb-2 text-micro font-semibold text-muted-foreground">GitHub</div>
                {githubStatusQuery.data?.connected ? (
                  <div className="rounded-md border border-border bg-surface-2 p-2 text-xs space-y-2">
                    <div className="flex items-center gap-2">
                      <Github className="h-3.5 w-3.5 text-primary" />
                      <span>{githubStatusQuery.data.owner}/{githubStatusQuery.data.repo}</span>
                    </div>
                    <div className="text-micro text-muted-foreground">Token: {githubStatusQuery.data.maskedToken}</div>
                    <div className="space-y-1 max-h-28 overflow-auto scrollbar-thin">
                      {(pullsQuery.data ?? []).map((pr) => (
                        <a key={pr.number} href={pr.htmlUrl} target="_blank" rel="noreferrer" className="block rounded border border-border px-2 py-1 hover:bg-card">
                          <div className="truncate">{pr.title}</div>
                          <div className="text-micro text-muted-foreground">#{pr.number} · {pr.state} · {pr.head} → {pr.base}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-surface-2 p-2 space-y-2">
                    <input value={githubOwner} onChange={(event) => setGithubOwner(event.target.value)} placeholder="owner" className="h-8 w-full rounded-md border border-border bg-card px-3 text-xs" />
                    <input value={githubRepo} onChange={(event) => setGithubRepo(event.target.value)} placeholder="repo" className="h-8 w-full rounded-md border border-border bg-card px-3 text-xs" />
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={githubToken}
                      onChange={(event) => setGithubToken(event.target.value)}
                      placeholder="github_pat_..."
                      aria-label="GitHub personal access token"
                      className="h-8 w-full rounded-md border border-border bg-card px-3 text-xs font-mono"
                    />
                    <button onClick={() => void connectRepo()} className="w-full rounded-md bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20">
                      Connect GitHub
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="flex items-center border-b border-border">
          <div className="flex">
            {(['git', 'diff', 'editor'] as const).map((item) => (
              <button key={item} onClick={() => setTab(item)} className={cn('px-4 py-2 text-xs capitalize border-b-2 transition-colors', tab === item ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {item === 'git' ? 'Git & PRs' : item === 'diff' ? 'Diff View' : 'Editor'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto scrollbar-thin">
          {tab === 'git' && (
            <div className="p-4 space-y-4 animate-fade-in">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-semibold">Commit Changes</div>
                <div className="flex gap-2">
                  <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="feat: add synthesis pipeline" className="h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 text-sm" />
                  <button onClick={() => void doCommit()} className="rounded-md bg-primary px-4 text-xs text-primary-foreground hover:bg-primary/90">Commit</button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 text-sm font-semibold">Commit History</div>
                <div className="space-y-2">
                  {commits.map((commit) => (
                    <button
                      key={commit.hash}
                      onClick={() => { setSelectedRef(commit.hash); setTab('diff'); }}
                      className="flex w-full items-start justify-between rounded-md border border-border px-3 py-2 text-left hover:border-primary/30"
                    >
                      <div>
                        <div className="text-sm">{commit.summary}</div>
                        <div className="text-micro text-muted-foreground">{commit.author} · {commit.authoredAt}</div>
                      </div>
                      <span className="font-mono text-micro text-muted-foreground">{commit.shortHash}</span>
                    </button>
                  ))}
                </div>
              </div>

              {githubStatusQuery.data?.connected && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                  <div className="text-sm font-semibold">Create Pull Request</div>
                  <input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="feat: synthesize auth module" className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={prHead} onChange={(event) => setPrHead(event.target.value)} placeholder={currentBranch} className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
                    <input value={prBase} onChange={(event) => setPrBase(event.target.value)} placeholder="main" className="h-9 rounded-md border border-border bg-surface-2 px-3 text-sm" />
                  </div>
                  <button onClick={() => void createPr()} className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20">
                    Create PR
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'diff' && (
            <div className="p-4 animate-fade-in space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedRef('WORKTREE')} className={cn('rounded-md px-2 py-1 text-xs', selectedRef === 'WORKTREE' ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
                  Working Tree
                </button>
                {commits.slice(0, 8).map((commit) => (
                  <button key={commit.hash} onClick={() => setSelectedRef(commit.hash)} className={cn('rounded-md px-2 py-1 text-xs font-mono', selectedRef === commit.hash ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}>
                    {commit.shortHash}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
                <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                  {diffQuery.data?.reference ?? selectedRef}
                </div>
                <pre className="max-h-[70vh] overflow-auto p-4 text-xs font-mono whitespace-pre-wrap">{diffQuery.data?.patch || 'No diff available.'}</pre>
              </div>
            </div>
          )}

          {tab === 'editor' && (
            <div className="h-full animate-fade-in">
              {selectedFile ? (
                <>
                  <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
                    <span>{selectedFile}</span>
                    {statusMap[selectedFile] && <span className="font-mono text-warning">{statusMap[selectedFile].indexStatus}{statusMap[selectedFile].worktreeStatus}</span>}
                    {statusMap[selectedFile] && (
                      <button onClick={() => void restorePath(selectedFile)} className="ml-auto flex items-center gap-1 rounded border border-border px-2 py-1 text-micro text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    value={fileQuery.data?.content ?? ''}
                    language={selectedFile.endsWith('.rs') ? 'rust' : selectedFile.endsWith('.ts') || selectedFile.endsWith('.tsx') ? 'typescript' : selectedFile.endsWith('.md') ? 'markdown' : 'plaintext'}
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, wordWrap: 'on' }}
                  />
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">Select a file from the tree.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
