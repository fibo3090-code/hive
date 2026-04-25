import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authoredAt: string;
  summary: string;
}

export interface GitTreeEntry {
  path: string;
  name: string;
  kind: string;
  size: number | null;
}

export interface GitFile {
  path: string;
  reference: string;
  content: string;
  binary: boolean;
}

export interface GitDiff {
  reference: string;
  patch: string;
}

export interface GitHubStatus {
  connected: boolean;
  owner: string | null;
  repo: string | null;
  defaultBranch: string | null;
  maskedToken: string | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  author: string;
  head: string;
  base: string;
}

function invalidateGit(qc: ReturnType<typeof useQueryClient>, projectId?: string | null) {
  qc.invalidateQueries({ queryKey: ['workspace-info', projectId] });
  qc.invalidateQueries({ queryKey: ['git-status', projectId] });
  qc.invalidateQueries({ queryKey: ['git-branches', projectId] });
  qc.invalidateQueries({ queryKey: ['git-log', projectId] });
  qc.invalidateQueries({ queryKey: ['git-tree', projectId] });
  qc.invalidateQueries({ queryKey: ['git-diff', projectId] });
  qc.invalidateQueries({ queryKey: ['git-file', projectId] });
  qc.invalidateQueries({ queryKey: ['github-status', projectId] });
  qc.invalidateQueries({ queryKey: ['github-pulls', projectId] });
}

export function useGitStatus(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['git-status', projectId],
    queryFn: () => api<GitStatusEntry[]>(`/v1/projects/${projectId}/git/status`),
    enabled: Boolean(projectId),
  });
}

export function useGitBranches(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['git-branches', projectId],
    queryFn: () => api<GitBranch[]>(`/v1/projects/${projectId}/git/branches`),
    enabled: Boolean(projectId),
  });
}

export function useGitLog(projectId: string | null | undefined, limit = 30) {
  return useQuery({
    queryKey: ['git-log', projectId, limit],
    queryFn: () => api<GitCommit[]>(`/v1/projects/${projectId}/git/log?limit=${limit}`),
    enabled: Boolean(projectId),
  });
}

export function useGitTree(projectId: string | null | undefined, reference?: string | null) {
  const query = reference ? `?ref=${encodeURIComponent(reference)}` : '';
  return useQuery({
    queryKey: ['git-tree', projectId, reference ?? 'HEAD'],
    queryFn: () => api<GitTreeEntry[]>(`/v1/projects/${projectId}/git/tree${query}`),
    enabled: Boolean(projectId),
  });
}

export function useGitFile(projectId: string | null | undefined, path: string | null, reference?: string | null) {
  const query = new URLSearchParams();
  if (path) query.set('path', path);
  if (reference) query.set('ref', reference);
  return useQuery({
    queryKey: ['git-file', projectId, path, reference ?? 'HEAD'],
    queryFn: () => api<GitFile>(`/v1/projects/${projectId}/git/file?${query.toString()}`),
    enabled: Boolean(projectId && path),
  });
}

export function useGitDiff(projectId: string | null | undefined, reference: string | null | undefined) {
  return useQuery({
    queryKey: ['git-diff', projectId, reference ?? 'WORKTREE'],
    queryFn: () => api<GitDiff>(`/v1/projects/${projectId}/git/diff/${encodeURIComponent(reference ?? 'WORKTREE')}`),
    enabled: Boolean(projectId && reference !== undefined),
  });
}

export function useInitGitRepo(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean }>(`/v1/projects/${projectId}/git/init`, { method: 'POST' }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useCreateGitBranch(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<{ ok: boolean; name: string }>(`/v1/projects/${projectId}/git/branches`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useCheckoutGitBranch(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, create = false }: { name: string; create?: boolean }) =>
      api<{ ok: boolean; name: string }>(`/v1/projects/${projectId}/git/checkout`, {
        method: 'POST',
        body: JSON.stringify({ name, create }),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useCommitGit(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { message: string; author?: string; email?: string; paths?: string[] }) =>
      api<GitCommit>(`/v1/projects/${projectId}/git/commit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useRestoreGit(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api<{ ok: boolean }>(`/v1/projects/${projectId}/git/restore`, {
        method: 'POST',
        body: JSON.stringify({ paths }),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useGitHubStatus(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['github-status', projectId],
    queryFn: () => api<GitHubStatus>(`/v1/projects/${projectId}/github/status`),
    enabled: Boolean(projectId),
  });
}

export function useGitHubPulls(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['github-pulls', projectId],
    queryFn: () => api<GitHubPullRequest[]>(`/v1/projects/${projectId}/github/pulls`),
    enabled: Boolean(projectId),
  });
}

export function useConnectGitHub(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { token: string; owner: string; repo: string }) =>
      api<GitHubStatus>(`/v1/projects/${projectId}/github/connect`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}

export function useCreateGitHubPull(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title: string; body?: string; head: string; base: string }) =>
      api<GitHubPullRequest>(`/v1/projects/${projectId}/github/pulls`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateGit(qc, projectId),
  });
}
