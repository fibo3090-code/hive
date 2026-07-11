import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * Reusable capability package attachable to agents. A skill spliced into
 * an agent's system prompt extends what tools and paths it can touch
 * without recompiling code — the lightweight cousin of a synthesised
 * module.
 */
export interface Skill {
  id: string;
  /** `null` for global (cross-project) skills. */
  projectId: string | null;
  slug: string;
  name: string;
  description: string;
  systemPromptFragment: string;
  allowedToolsJson: string[];
  allowedPathsJson: string[];
  requiresConnectorIdsJson: string[];
  capabilitiesJson: string[];
  /** Long-form playbook. The agent pulls it on demand via `read_skill`. */
  markdownBody: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  /** Omit/null for a global skill. */
  projectId?: string | null;
  slug: string;
  name: string;
  description: string;
  systemPromptFragment?: string;
  allowedToolsJson?: string[];
  allowedPathsJson?: string[];
  requiresConnectorIdsJson?: string[];
  capabilitiesJson?: string[];
  markdownBody?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  systemPromptFragment?: string;
  allowedToolsJson?: string[];
  allowedPathsJson?: string[];
  requiresConnectorIdsJson?: string[];
  capabilitiesJson?: string[];
  markdownBody?: string;
}

const skillsKey = (projectId: string | null | undefined) =>
  ['skills', projectId ?? '_global'] as const;

export function useSkills(projectId: string | null | undefined) {
  return useQuery({
    queryKey: skillsKey(projectId),
    queryFn: () => api<Skill[]>(`/v1/projects/${encodeURIComponent(String(projectId))}/skills`),
    enabled: Boolean(projectId),
  });
}

export function useCreateSkill(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) =>
      api<Skill>(`/v1/projects/${encodeURIComponent(String(projectId))}/skills`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey(projectId) }),
  });
}

export function useUpdateSkill(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSkillInput }) =>
      api<Skill>(`/v1/skills/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey(projectId) }),
  });
}

export function useDeleteSkill(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true; id: string }>(`/v1/skills/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsKey(projectId) }),
  });
}
