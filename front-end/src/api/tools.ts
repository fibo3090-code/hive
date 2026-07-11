import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface WorkspaceInfo {
  projectId: string;
  sandboxKind: 'local-fs' | 'docker';
  status: 'missing' | 'ready';
  rootPath: string;
}

export function useWorkspaceInfo(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['workspace-info', projectId],
    queryFn: () => api<WorkspaceInfo>(`/v1/projects/${encodeURIComponent(String(projectId))}/workspace/info`),
    enabled: Boolean(projectId),
  });
}

export function useInitWorkspace(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<WorkspaceInfo>(`/v1/projects/${encodeURIComponent(String(projectId))}/workspace/init`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-info', projectId] });
    },
  });
}
