import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export type SpecDocumentSource = 'ceo-conversation' | 'onboarding' | 'upload' | 'manual';

export interface SpecDocument {
  id: string;
  projectId: string;
  title: string;
  source: SpecDocumentSource;
  markdown: string;
  /** Bumped on every markdown edit. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpecDocumentSection {
  id: string;
  specDocumentId: string;
  /** Slugified at write-time; tasks FK on this. */
  anchor: string;
  title: string;
  body: string;
  ordinal: number;
}

export interface CreateSpecDocumentInput {
  title: string;
  source: SpecDocumentSource;
  markdown?: string;
}

export interface UpdateSpecDocumentInput {
  title?: string;
  markdown: string;
}

/** Output of the doc→sprint decomposition step. */
export interface DecomposeOutput {
  sprints: Array<{
    name: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
    tasks: Array<{
      title: string;
      specSectionAnchor?: string;
      agentRole?: string;
      priority?: string;
      estimatedTokens?: number;
      dueAt?: string;
    }>;
  }>;
}

export interface MaterializeResult {
  sprintIds: string[];
  taskIds: string[];
  /** Anchors referenced by tasks but not found in the document — surface
   *  as warnings in the UI so the user can edit the spec or accept the
   *  unlinked task. */
  unmatchedAnchors: string[];
}

const docsKey = (projectId: string | null | undefined) =>
  ['spec-documents', projectId ?? '_none'] as const;
const sectionsKey = (specDocumentId: string | null | undefined) =>
  ['spec-document-sections', specDocumentId ?? '_none'] as const;

export function useSpecDocuments(projectId: string | null | undefined) {
  return useQuery({
    queryKey: docsKey(projectId),
    queryFn: () => api<SpecDocument[]>(`/v1/projects/${encodeURIComponent(String(projectId))}/spec-documents`),
    enabled: Boolean(projectId),
  });
}

export function useSpecDocument(specDocumentId: string | null | undefined) {
  return useQuery({
    queryKey: ['spec-document', specDocumentId ?? '_none'],
    queryFn: () => api<SpecDocument>(`/v1/spec-documents/${encodeURIComponent(String(specDocumentId))}`),
    enabled: Boolean(specDocumentId),
  });
}

export function useSpecDocumentSections(specDocumentId: string | null | undefined) {
  return useQuery({
    queryKey: sectionsKey(specDocumentId),
    queryFn: () =>
      api<SpecDocumentSection[]>(`/v1/spec-documents/${encodeURIComponent(String(specDocumentId))}/sections`),
    enabled: Boolean(specDocumentId),
  });
}

export function useCreateSpecDocument(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSpecDocumentInput) =>
      api<SpecDocument>(`/v1/projects/${encodeURIComponent(String(projectId))}/spec-documents`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: docsKey(projectId) });
      qc.invalidateQueries({ queryKey: sectionsKey(doc.id) });
    },
  });
}

export function useUpdateSpecDocument(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSpecDocumentInput }) =>
      api<SpecDocument>(`/v1/spec-documents/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: docsKey(projectId) });
      qc.invalidateQueries({ queryKey: ['spec-document', doc.id] });
      qc.invalidateQueries({ queryKey: sectionsKey(doc.id) });
    },
  });
}

export function useDecomposeSpecDocument(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specDocumentId,
      decomposition,
      startingPosition,
    }: {
      specDocumentId: string;
      decomposition: DecomposeOutput;
      startingPosition?: number;
    }) =>
      api<MaterializeResult>(`/v1/spec-documents/${encodeURIComponent(String(specDocumentId))}/decompose`, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          decomposition,
          startingPosition: startingPosition ?? 0,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}
