import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export type LlmProviderKind = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface LlmProvider {
  id: string;
  name: string;
  kind: LlmProviderKind;
  connected: boolean;
  baseUrl: string | null;
  maskedKey: string | null;
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmModel {
  id: string;
  label: string;
  contextWindow: number | null;
  supportsTools: boolean;
  supportsStreaming: boolean;
}

export interface LlmTestOutcome {
  ok: boolean;
  error: string | null;
  sampleModels: string[];
}

export function useLlmProviders() {
  return useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => api<LlmProvider[]>('/v1/llm-providers'),
  });
}

export function useProviderModels(providerId: string | null | undefined) {
  return useQuery({
    queryKey: ['llm-providers', providerId, 'models'],
    queryFn: () => api<LlmModel[]>(`/v1/llm-providers/${providerId}/models`),
    enabled: Boolean(providerId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTestProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      api<LlmTestOutcome>(`/v1/llm-providers/${providerId}/test`, { method: 'POST' }),
    onSuccess: (_data, providerId) => {
      qc.invalidateQueries({ queryKey: ['llm-providers'] });
      qc.invalidateQueries({ queryKey: ['llm-providers', providerId, 'models'] });
    },
  });
}

export function useSetProviderKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { providerId: string; apiKey?: string; baseUrl?: string }) =>
      api<LlmProvider>(`/v1/llm-providers/${input.providerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ apiKey: input.apiKey, baseUrl: input.baseUrl }),
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['llm-providers'] });
      qc.invalidateQueries({ queryKey: ['llm-providers', input.providerId, 'models'] });
    },
  });
}

/**
 * Force a fresh fetch of the provider's model list, ignoring the in-memory
 * server-side cache. Wired to the `Refresh Models` button in Settings;
 * useful right after the user adds a new model on their provider account
 * or rotates a key.
 */
export function useRefreshProviderModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) =>
      api<LlmModel[]>(`/v1/llm-providers/${providerId}/refresh-models`, { method: 'POST' }),
    onSuccess: (_data, providerId) => {
      qc.invalidateQueries({ queryKey: ['llm-providers', providerId, 'models'] });
    },
  });
}
