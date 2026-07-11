import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

export type ConnectorKind = 'api' | 'mcp';
export type ConnectorAuthKind =
  | 'none'
  | 'bearer'
  | 'basic'
  | 'oauth2'
  | 'mcp_handshake';
export type ConnectorStatus = 'untested' | 'connected' | 'error';

/**
 * External integration: HTTP API or MCP server. Credentials encrypt at
 * rest via hive-crypto (same as LLM provider keys); only the masked key
 * surfaces to the UI for "yes I set this" feedback.
 */
export interface Connector {
  id: string;
  projectId: string;
  kind: ConnectorKind;
  slug: string;
  name: string;
  baseUrl: string | null;
  authKind: ConnectorAuthKind;
  /** Last few chars of the credential, never the credential itself. */
  maskedKey: string | null;
  configJson: Record<string, unknown>;
  /** Cached MCP `initialize` response when `kind="mcp"`. */
  protocolHandshakeJson: Record<string, unknown> | null;
  status: ConnectorStatus;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorInput {
  kind: ConnectorKind;
  slug: string;
  name: string;
  baseUrl?: string;
  authKind?: ConnectorAuthKind;
  /** Plain credential — encrypted server-side. Omit for `auth_kind: 'none'`. */
  credential?: string;
  configJson?: Record<string, unknown>;
}

export interface UpdateConnectorStatusInput {
  status: ConnectorStatus;
  /** When `kind="mcp"`, the cached handshake to overwrite. */
  handshake?: Record<string, unknown>;
}

const connectorsKey = (projectId: string | null | undefined) =>
  ['connectors', projectId ?? '_none'] as const;

export function useConnectors(projectId: string | null | undefined) {
  return useQuery({
    queryKey: connectorsKey(projectId),
    queryFn: () => api<Connector[]>(`/v1/projects/${encodeURIComponent(String(projectId))}/connectors`),
    enabled: Boolean(projectId),
  });
}

export function useCreateConnector(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectorInput) =>
      api<Connector>(`/v1/projects/${encodeURIComponent(String(projectId))}/connectors`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorsKey(projectId) }),
  });
}

export function useUpdateConnectorStatus(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConnectorStatusInput }) =>
      api<Connector>(`/v1/connectors/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorsKey(projectId) }),
  });
}

export function useDeleteConnector(projectId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true; id: string }>(`/v1/connectors/${encodeURIComponent(String(id))}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectorsKey(projectId) }),
  });
}
