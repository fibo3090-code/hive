import { useEffect, useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_BASE_URL, eventStreamUrl } from '@/api/client';

export interface ChatThread {
  id: string;
  projectId: string;
  agentId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';
export type ChatStatus = 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';

export interface ToolCallTrace {
  tool: string;
  arguments?: unknown;
  result?: unknown;
  request?: unknown;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  toolCalls: ToolCallTrace[];
  model: string | null;
  providerId: string | null;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  parentMessageId: string | null;
  status: ChatStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  providerId: string;
  model: string;
}

export function useChatThreads(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-threads', projectId],
    queryFn: () => api<ChatThread[]>(`/v1/projects/${projectId}/chat-threads`),
    enabled: Boolean(projectId),
  });
}

export function useChatMessages(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-messages', threadId],
    queryFn: () => api<ChatMessage[]>(`/v1/chat-threads/${threadId}/messages`),
    enabled: Boolean(threadId),
    staleTime: 0,
  });
}

export function useCreateChatThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; agentId?: string | null; title?: string }) =>
      api<ChatThread>('/v1/chat-threads', {
        method: 'POST',
        body: JSON.stringify({
          projectId: input.projectId,
          agentId: input.agentId ?? null,
          title: input.title,
        }),
      }),
    onSuccess: (_thread, input) => {
      qc.invalidateQueries({ queryKey: ['chat-threads', input.projectId] });
    },
  });
}

export function useSendChatMessage(threadId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      threadId?: string | null;
      content: string;
      model?: { providerId: string; modelId: string } | null;
      systemPrompt?: string;
    }) =>
      api<SendMessageResponse>(`/v1/chat-threads/${input.threadId ?? threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: input.content,
          model: input.model ?? null,
          systemPrompt: input.systemPrompt ?? null,
        }),
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', input.threadId ?? threadId] });
    },
  });
}

export function useCancelChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<{ ok: boolean }>(`/v1/chat-messages/${messageId}/cancel`, { method: 'POST' }),
    onSuccess: (_data, messageId) => {
      // We don't know the thread id here, so invalidate all chat-messages caches.
      // The streaming hook below is the source of truth for the in-flight UI.
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      void messageId;
    },
  });
}

/**
 * Subscribe to chat.<threadId>.* server-sent events and accumulate streaming
 * text by `assistantMessageId`. Token deltas go into `streaming[id]`; when
 * the `complete` or `cancelled` event fires we invalidate the history query
 * so the final persisted message replaces the live buffer.
 */
export interface StreamingState {
  [messageId: string]:
    | {
        content: string;
        status: 'streaming' | 'complete' | 'cancelled' | 'error';
        tokensIn?: number;
        tokensOut?: number;
        costCents?: number;
        toolCalls?: ToolCallTrace[];
      }
    | undefined;
}

export function useChatStream(threadId: string | null | undefined) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState<StreamingState>({});
  const streamingRef = useRef<StreamingState>({});

  const update = useCallback((next: StreamingState) => {
    streamingRef.current = next;
    setStreaming(next);
  }, []);

  useEffect(() => {
    if (!threadId) {
      return;
    }
    const source = new EventSource(eventStreamUrl('/v1/events'));

    const onToken = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          threadId: string;
          messageId: string;
          delta: string;
        };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        const nextContent = (current?.content ?? '') + data.delta;
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: nextContent,
            status: 'streaming',
            toolCalls: current?.toolCalls ?? [],
          },
        });
      } catch {
        /* ignore malformed chunks */
      }
    };

    const onComplete = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          threadId: string;
          messageId: string;
          tokensIn?: number;
          tokensOut?: number;
          costCents?: number;
        };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: 'complete',
            tokensIn: data.tokensIn,
            tokensOut: data.tokensOut,
            costCents: data.costCents,
            toolCalls: current?.toolCalls ?? [],
          },
        });
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      } catch {
        /* ignore */
      }
    };

    const onCancelled = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { threadId: string; messageId: string };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: 'cancelled',
            toolCalls: current?.toolCalls ?? [],
          },
        });
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      } catch {
        /* ignore */
      }
    };

    const onError = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { threadId: string; messageId: string };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: 'error',
            toolCalls: current?.toolCalls ?? [],
          },
        });
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      } catch {
        /* ignore */
      }
    };

    const onToolCall = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          threadId: string;
          messageId: string;
          tool: string;
          args?: unknown;
        };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        const toolCalls = [...(current?.toolCalls ?? []), { tool: data.tool, arguments: data.args }];
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: current?.status ?? 'streaming',
            tokensIn: current?.tokensIn,
            tokensOut: current?.tokensOut,
            costCents: current?.costCents,
            toolCalls,
          },
        });
      } catch {
        /* ignore */
      }
    };

    const onToolResult = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          threadId: string;
          messageId: string;
          tool: string;
          result?: unknown;
        };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        const toolCalls = [...(current?.toolCalls ?? [])];
        const index = [...toolCalls].reverse().findIndex((entry) => entry.tool === data.tool && entry.result === undefined);
        if (index >= 0) {
          const actualIndex = toolCalls.length - 1 - index;
          toolCalls[actualIndex] = { ...toolCalls[actualIndex], result: data.result };
        } else {
          toolCalls.push({ tool: data.tool, result: data.result });
        }
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: current?.status ?? 'streaming',
            tokensIn: current?.tokensIn,
            tokensOut: current?.tokensOut,
            costCents: current?.costCents,
            toolCalls,
          },
        });
      } catch {
        /* ignore */
      }
    };

    const onMessage = () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
    };

    source.addEventListener(`chat.${threadId}.token`, onToken as EventListener);
    source.addEventListener(`chat.${threadId}.complete`, onComplete as EventListener);
    source.addEventListener(`chat.${threadId}.cancelled`, onCancelled as EventListener);
    source.addEventListener(`chat.${threadId}.error`, onError as EventListener);
    source.addEventListener(`chat.${threadId}.message`, onMessage as EventListener);
    source.addEventListener(`chat.${threadId}.tool_call`, onToolCall as EventListener);
    source.addEventListener(`chat.${threadId}.tool_result`, onToolResult as EventListener);

    return () => {
      source.close();
    };
  }, [threadId, qc, update]);

  return streaming;
}

// Re-exported for ad-hoc callers that want to build their own fetch.
export { API_BASE_URL };
