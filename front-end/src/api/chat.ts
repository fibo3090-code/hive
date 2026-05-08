import { useEffect, useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, API_BASE_URL, eventStreamUrl } from '@/api/client';

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
  /** True when the request used `defer` and the caller must POST to
   *  `/v1/chat-messages/:assistantId/process` to start the runtime
   *  (typically because attachments are uploading). */
  deferred?: boolean;
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
      /** When true, server skips spawning the runtime; caller must
       *  follow up with `useProcessChatMessage` once attachments
       *  are uploaded. */
      defer?: boolean;
    }) =>
      api<SendMessageResponse>(`/v1/chat-threads/${input.threadId ?? threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: input.content,
          model: input.model ?? null,
          systemPrompt: input.systemPrompt ?? null,
          defer: input.defer ?? false,
        }),
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', input.threadId ?? threadId] });
    },
  });
}

/** Companion to `useSendChatMessage` when `defer: true` was used.
 *  Idempotent — the server only spawns the runtime if the assistant
 *  row is still `pending`. */
export function useProcessChatMessage() {
  return useMutation({
    mutationFn: (assistantMessageId: string) =>
      api<{ ok: boolean; assistantMessageId?: string; reason?: string }>(
        `/v1/chat-messages/${assistantMessageId}/process`,
        { method: 'POST' },
      ),
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
export interface ContextTrimNotice {
  /** How many oldest messages were dropped before the LLM call. */
  dropped: number;
  /** Estimated tokens after trimming. */
  estimatedTokens: number;
  /** Effective context window for the model. */
  contextWindow: number;
}

export interface StreamingState {
  [messageId: string]:
    | {
        content: string;
        status: 'streaming' | 'complete' | 'cancelled' | 'error';
        tokensIn?: number;
        tokensOut?: number;
        costCents?: number;
        toolCalls?: ToolCallTrace[];
        /** Set if pre-flight context trimming kicked in. */
        contextTrim?: ContextTrimNotice;
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
      } catch (err) {
        console.warn('[chat-stream] malformed token chunk', err);
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
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
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
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
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
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
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
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
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
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
      }
    };

    const onMessage = () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
    };

    const onContextTrim = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          threadId: string;
          messageId: string;
          dropped: number;
          estimatedTokens: number;
          contextWindow: number;
        };
        if (data.threadId !== threadId) return;
        const current = streamingRef.current[data.messageId];
        update({
          ...streamingRef.current,
          [data.messageId]: {
            content: current?.content ?? '',
            status: current?.status ?? 'streaming',
            tokensIn: current?.tokensIn,
            tokensOut: current?.tokensOut,
            costCents: current?.costCents,
            toolCalls: current?.toolCalls ?? [],
            contextTrim: {
              dropped: data.dropped,
              estimatedTokens: data.estimatedTokens,
              contextWindow: data.contextWindow,
            },
          },
        });
      } catch (err) {
        // SSE frame failed JSON.parse. The connection is still healthy
        // — frames can race or be malformed by an upstream proxy. Log
        // at warn so it shows in the dev console; if frame loss is
        // ever a real issue, the count tells the story.
        console.warn('[chat-stream] malformed event', err);
      }
    };

    source.addEventListener(`chat.${threadId}.token`, onToken as EventListener);
    source.addEventListener(`chat.${threadId}.complete`, onComplete as EventListener);
    source.addEventListener(`chat.${threadId}.cancelled`, onCancelled as EventListener);
    source.addEventListener(`chat.${threadId}.error`, onError as EventListener);
    source.addEventListener(`chat.${threadId}.message`, onMessage as EventListener);
    source.addEventListener(`chat.${threadId}.tool_call`, onToolCall as EventListener);
    source.addEventListener(`chat.${threadId}.tool_result`, onToolResult as EventListener);
    source.addEventListener(`chat.${threadId}.context_trim`, onContextTrim as EventListener);

    return () => {
      source.close();
    };
  }, [threadId, qc, update]);

  return streaming;
}

// ── Attachments ───────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string;
  messageId: string;
  /** `'image' | 'text' | 'binary'` — drives how the message renderer
   * displays the attachment (image inline vs download chip). */
  kind: string;
  name: string;
  mimeType: string;
  bytesSize: number;
  createdAt: string;
}

export function useChatAttachments(messageId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-attachments', messageId],
    queryFn: () =>
      api<ChatAttachment[]>(`/v1/chat-messages/${messageId}/attachments`),
    enabled: Boolean(messageId),
    staleTime: 60_000,
  });
}

/** Upload one or more files to a chat message. The server enforces
 *  ≤ 10 MB per file and ≤ 5 attachments per message. */
export function useUploadChatAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { messageId: string; files: File[] }) => {
      const form = new FormData();
      for (const file of input.files) {
        form.append('file', file, file.name);
      }
      const response = await fetch(
        `${API_BASE_URL}/v1/chat-messages/${input.messageId}/attachments`,
        {
          method: 'POST',
          body: form,
        },
      );
      if (!response.ok) {
        const text = await response.text();
        let message = `Upload failed (${response.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          if (text) message = text;
        }
        throw new ApiError(message, 'upload_failed');
      }
      return (await response.json()) as ChatAttachment[];
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ['chat-attachments', vars.messageId],
      });
    },
  });
}

export function useDeleteChatAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; attachmentId: string }) =>
      api<{ ok: boolean }>(
        `/v1/chat-messages/${input.messageId}/attachments/${input.attachmentId}`,
        { method: 'DELETE' },
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ['chat-attachments', vars.messageId],
      });
    },
  });
}

export function attachmentDownloadUrl(messageId: string, attachmentId: string): string {
  return `${API_BASE_URL}/v1/chat-messages/${messageId}/attachments/${attachmentId}`;
}

// Re-exported for ad-hoc callers that want to build their own fetch.
export { API_BASE_URL };

export function useDeleteChatThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api<void>(`/v1/chat-threads/${threadId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
    },
  });
}
