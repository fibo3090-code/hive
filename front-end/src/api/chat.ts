import { useEffect, useState, useRef, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, API_BASE_URL, eventStreamUrl } from '@/api/client';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { logger } from '@/lib/logger';

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
  /** Inline validation/runtime error from the tool layer. */
  error?: string;
  /** UI status — set during streaming, not on persisted messages. */
  status?: 'running' | 'ok' | 'error';
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
  deferred?: boolean;
}

export function useChatThreads(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-threads', projectId],
    queryFn: () => api<ChatThread[]>(`/v1/projects/${encodeURIComponent(String(projectId))}/chat-threads`),
    enabled: Boolean(projectId),
  });
}

export function useChatMessages(threadId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-messages', threadId],
    queryFn: () => api<ChatMessage[]>(`/v1/chat-threads/${encodeURIComponent(String(threadId))}/messages`),
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
      defer?: boolean;
    }) =>
      api<SendMessageResponse>(`/v1/chat-threads/${encodeURIComponent(String(input.threadId ?? threadId))}/messages`, {
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

export function useProcessChatMessage() {
  return useMutation({
    mutationFn: (assistantMessageId: string) =>
      api<{ ok: boolean; assistantMessageId?: string; reason?: string }>(
        `/v1/chat-messages/${encodeURIComponent(String(assistantMessageId))}/process`,
        { method: 'POST' },
      ),
  });
}

export function useCancelChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api<{ ok: boolean }>(`/v1/chat-messages/${encodeURIComponent(String(messageId))}/cancel`, { method: 'POST' }),
    onSuccess: (_data, messageId) => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      void messageId;
    },
  });
}

export interface CompactResult {
  ok: boolean;
  summarizedCount: number;
  summary?: string;
  message?: string;
  messageId?: string;
}

export function useCompactChatThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api<CompactResult>(`/v1/chat-threads/${encodeURIComponent(String(threadId))}/compact`, { method: 'POST' }),
    onSuccess: (_data, threadId) => {
      qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
    },
  });
}

export interface ContextTrimNotice {
  dropped: number;
  estimatedTokens: number;
  contextWindow: number;
}

/**
 * A chunk of an assistant message in arrival order. Causal honesty (R2):
 * a message is the *sequence* of these segments as the model produced
 * them — interleaved text and tool calls — not "all text, then all tools".
 */
export type ChatSegment =
  | { kind: 'text'; content: string }
  | {
      kind: 'tool';
      /** Provider-assigned call id (when available — native tool-calling
       *  paths set this; XML-fallback may not). Used by `resolveTool` to
       *  disambiguate two parallel calls to the same tool name. */
      callId?: string;
      tool: string;
      args?: unknown;
      result?: unknown;
      error?: string;
      status: 'running' | 'ok' | 'error';
    };

export interface StreamingMessage {
  segments: ChatSegment[];
  /** Concatenated text segments — convenience for callers that just want text. */
  content: string;
  status: 'streaming' | 'complete' | 'cancelled' | 'error';
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
  durationMs?: number;
  contextTrim?: ContextTrimNotice;
}

export interface StreamingState {
  [messageId: string]: StreamingMessage | undefined;
}

interface TokenEvent { threadId: string; messageId: string; delta: string }
interface CompleteEvent { threadId: string; messageId: string; tokensIn?: number; tokensOut?: number; costCents?: number; durationMs?: number }
interface PlainEvent { threadId: string; messageId: string }
interface ToolCallEvent { threadId: string; messageId: string; callId?: string; tool: string; args?: unknown }
interface ToolResultEvent { threadId: string; messageId: string; callId?: string; tool: string; result?: unknown }
interface ToolValidationErrorEvent { threadId: string; messageId: string; callId?: string; tool: string; error?: string; message?: string }
interface ContextTrimEvent { threadId: string; messageId: string; dropped: number; estimatedTokens: number; contextWindow: number }

function deriveContent(segments: ChatSegment[]): string {
  return segments
    .filter((s): s is Extract<ChatSegment, { kind: 'text' }> => s.kind === 'text')
    .map((s) => s.content)
    .join('');
}

function appendText(segments: ChatSegment[], delta: string): ChatSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.kind === 'text') {
    return [...segments.slice(0, -1), { kind: 'text', content: last.content + delta }];
  }
  return [...segments, { kind: 'text', content: delta }];
}

function pushToolCall(
  segments: ChatSegment[],
  tool: string,
  args: unknown,
  callId?: string,
): ChatSegment[] {
  return [...segments, { kind: 'tool', callId, tool, args, status: 'running' }];
}

/**
 * Resolve a tool result/error onto the segment that started it. Matching
 * is **callId-first** (exact id) and falls back to "most recent running
 * segment with this tool name" when the provider didn't supply an id
 * (XML-fallback path). Without callId disambiguation two parallel calls
 * to the same tool produced swapped results.
 */
function resolveTool(
  segments: ChatSegment[],
  tool: string,
  patch: Partial<Extract<ChatSegment, { kind: 'tool' }>>,
  callId?: string,
): ChatSegment[] {
  // Pass 1: exact callId match. Only meaningful when the producer sent
  // an id (native tool calling does, XML fallback does not).
  if (callId) {
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (seg.kind === 'tool' && seg.callId === callId) {
        const next = [...segments];
        next[i] = { ...seg, ...patch };
        return next;
      }
    }
  }
  // Pass 2: fall back to "most recent running with this name". Wrong
  // when two parallel same-name calls are in-flight without ids, but
  // that's the best we can do without an id; backend native-call paths
  // always emit one so this branch fires only on XML-fallback.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.kind === 'tool' && seg.tool === tool && seg.status === 'running') {
      const next = [...segments];
      next[i] = { ...seg, ...patch };
      return next;
    }
  }
  // No matching segment — append a synthetic one so the result isn't dropped.
  return [...segments, { kind: 'tool', callId, tool, status: patch.status ?? 'ok', ...patch }];
}

/**
 * Subscribe to chat.<threadId>.* events through the shared RealtimeProvider
 * and accumulate streaming text + tool calls **in arrival order**. Returns
 * a map of `messageId → StreamingMessage`.
 */
export function useChatStream(threadId: string | null | undefined) {
  const qc = useQueryClient();
  const { subscribe } = useRealtime();
  const [streaming, setStreaming] = useState<StreamingState>({});
  const stateRef = useRef<StreamingState>({});

  const update = useCallback((messageId: string, patch: (prev: StreamingMessage | undefined) => StreamingMessage) => {
    const prev = stateRef.current[messageId];
    const next = patch(prev);
    const nextState: StreamingState = { ...stateRef.current, [messageId]: next };
    stateRef.current = nextState;
    setStreaming(nextState);
  }, []);

  useEffect(() => {
    if (!threadId) return;

    const unsubs: Array<() => void> = [];

    const blankMsg = (): StreamingMessage => ({ segments: [], content: '', status: 'streaming' });

    const safeParse = <T,>(event: MessageEvent): T | null => {
      try {
        return JSON.parse(event.data) as T;
      } catch (err) {
        logger.warn('chat-stream', 'malformed event', err);
        return null;
      }
    };

    unsubs.push(
      subscribe(`chat.${threadId}.streaming`, (event) => {
        const data = safeParse<PlainEvent>(event);
        if (!data || data.threadId !== threadId) return;
        // Marker that the model started producing output. We seed an empty
        // message entry so the UI flips to "streaming…" immediately even
        // before the first token lands.
        update(data.messageId, (prev) => prev ?? blankMsg());
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.token`, (event) => {
        const data = safeParse<TokenEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => {
          const base = prev ?? blankMsg();
          const segments = appendText(base.segments, data.delta);
          return { ...base, segments, content: deriveContent(segments), status: 'streaming' };
        });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.tool_call`, (event) => {
        const data = safeParse<ToolCallEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => {
          const base = prev ?? blankMsg();
          return {
            ...base,
            segments: pushToolCall(base.segments, data.tool, data.args, data.callId),
            status: 'streaming',
          };
        });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.tool_result`, (event) => {
        const data = safeParse<ToolResultEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => {
          const base = prev ?? blankMsg();
          return {
            ...base,
            segments: resolveTool(
              base.segments,
              data.tool,
              { result: data.result, status: 'ok' },
              data.callId,
            ),
          };
        });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.tool_validation_error`, (event) => {
        const data = safeParse<ToolValidationErrorEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => {
          const base = prev ?? blankMsg();
          return {
            ...base,
            segments: resolveTool(
              base.segments,
              data.tool,
              {
                error: data.error ?? data.message ?? 'validation error',
                status: 'error',
              },
              data.callId,
            ),
          };
        });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.complete`, (event) => {
        const data = safeParse<CompleteEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => {
          const base = prev ?? blankMsg();
          return {
            ...base,
            status: 'complete',
            tokensIn: data.tokensIn,
            tokensOut: data.tokensOut,
            costCents: data.costCents,
            durationMs: data.durationMs,
          };
        });
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.cancelled`, (event) => {
        const data = safeParse<PlainEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => ({ ...(prev ?? blankMsg()), status: 'cancelled' }));
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.error`, (event) => {
        const data = safeParse<PlainEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => ({ ...(prev ?? blankMsg()), status: 'error' }));
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.message`, () => {
        qc.invalidateQueries({ queryKey: ['chat-messages', threadId] });
      }),
    );

    unsubs.push(
      subscribe(`chat.${threadId}.context_trim`, (event) => {
        const data = safeParse<ContextTrimEvent>(event);
        if (!data || data.threadId !== threadId) return;
        update(data.messageId, (prev) => ({
          ...(prev ?? blankMsg()),
          contextTrim: { dropped: data.dropped, estimatedTokens: data.estimatedTokens, contextWindow: data.contextWindow },
        }));
      }),
    );

    return () => {
      for (const u of unsubs) u();
    };
  }, [threadId, qc, subscribe, update]);

  return streaming;
}

// ── Attachments ───────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string;
  messageId: string;
  kind: string;
  name: string;
  mimeType: string;
  bytesSize: number;
  createdAt: string;
}

export function useChatAttachments(messageId: string | null | undefined) {
  return useQuery({
    queryKey: ['chat-attachments', messageId],
    queryFn: () => api<ChatAttachment[]>(`/v1/chat-messages/${encodeURIComponent(String(messageId))}/attachments`),
    enabled: Boolean(messageId),
    staleTime: 60_000,
  });
}

export function useUploadChatAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { messageId: string; files: File[] }) => {
      const form = new FormData();
      for (const file of input.files) {
        form.append('file', file, file.name);
      }
      const response = await fetch(`${API_BASE_URL}/v1/chat-messages/${encodeURIComponent(String(input.messageId))}/attachments`, {
        method: 'POST',
        body: form,
      });
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
      qc.invalidateQueries({ queryKey: ['chat-attachments', vars.messageId] });
    },
  });
}

export function useDeleteChatAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; attachmentId: string }) =>
      api<{ ok: boolean }>(`/v1/chat-messages/${encodeURIComponent(String(input.messageId))}/attachments/${encodeURIComponent(String(input.attachmentId))}`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['chat-attachments', vars.messageId] });
    },
  });
}

export function attachmentDownloadUrl(messageId: string, attachmentId: string): string {
  return `${API_BASE_URL}/v1/chat-messages/${encodeURIComponent(String(messageId))}/attachments/${encodeURIComponent(String(attachmentId))}`;
}

export { API_BASE_URL };
export { eventStreamUrl };

export function useDeleteChatThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api<void>(`/v1/chat-threads/${encodeURIComponent(String(threadId))}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-threads'] });
    },
  });
}
