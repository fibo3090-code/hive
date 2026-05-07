import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

/** MCP server generated on the fly by the auto-spawn pipeline for a
 *  specific agent. Reusable when `reusable=true` so future spawns can
 *  match against it instead of regenerating. */
export interface CustomMcpServer {
  id: string;
  projectId: string;
  ownerAgentId: string | null;
  name: string;
  slug: string;
  sourceApiUrl: string | null;
  sourceApiSpecJson: Record<string, unknown> | null;
  generatedManifestJson: Record<string, unknown>;
  generatedHandlerCode: string;
  transport: 'http';
  status: 'draft' | 'active' | 'disabled' | 'error';
  reusable: boolean;
  capabilitiesJson: string[];
  embeddingJson: number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMcpBinding {
  id: string;
  agentId: string;
  mcpServerId: string;
  /** Discriminator for the FK target. */
  kind: 'custom' | 'connector';
  createdAt: string;
}

export function useCustomMcpServers(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['custom-mcp-servers', projectId ?? '_none'],
    queryFn: () =>
      api<CustomMcpServer[]>(`/v1/projects/${projectId}/custom-mcp-servers`),
    enabled: Boolean(projectId),
  });
}

export function useAgentMcpBindings(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ['agent-mcp-bindings', agentId ?? '_none'],
    queryFn: () => api<AgentMcpBinding[]>(`/v1/agents/${agentId}/mcp-bindings`),
    enabled: Boolean(agentId),
  });
}
