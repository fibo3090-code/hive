import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { JsonViewer } from '@/components/shared/JsonViewer';
import { MetadataFooter } from '@/components/shared/MetadataFooter';
import { CodeViewerDialog } from '@/components/modals/CodeViewerDialog';
import { Send, Paperclip, AtSign, Hexagon, Copy, Eye, Code, AlertTriangle, ArrowDown, Check, Square, Plus, Settings2, X, FileText, Image as ImageIcon, FileBox, Trash2, LayoutList, RefreshCcw } from 'lucide-react';
import { useHiveData } from '@/api/queries/useHiveData';
import { StatusDot } from '@/components/shared/StatusDot';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import {
  useChatThreads,
  useChatMessages,
  useChatStream,
  useCreateChatThread,
  useDeleteChatThread,
  useCompactChatThread,
  useSendChatMessage,
  useCancelChatMessage,
  useChatAttachments,
  useUploadChatAttachments,
  useProcessChatMessage,
  attachmentDownloadUrl,
  type ChatAttachment,
  type ChatMessage,
  type ChatSegment,
  type ChatThread,
  type ToolCallTrace,
} from '@/api/chat';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

function CodeBlock({ language, code }: { readonly language: string; readonly code: string }) {
  const [copied, setCopied] = useState(false);
  const [viewer, setViewer] = useState<'preview' | 'inspect' | null>(null);
  // Track the pending "reset copied" timer in a ref so we can cancel it
  // when the component unmounts mid-flight. Without this, an unmount
  // between Copy and the 1.5s reset triggers `setState on unmounted`.
  const resetTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);
  return (
    <>
      <div className="rounded-md border border-border bg-surface-2 mt-2 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 border-b border-border">
          <span className="text-micro font-mono text-muted-foreground">{language}</span>
          <div className="flex gap-1">
            <button
              onClick={() => {
                navigator.clipboard.writeText(code);
                setCopied(true);
                if (resetTimerRef.current !== null) {
                  clearTimeout(resetTimerRef.current);
                }
                resetTimerRef.current = globalThis.setTimeout(() => {
                  setCopied(false);
                  resetTimerRef.current = null;
                }, 1500) as unknown as number;
              }}
              className="text-muted-foreground hover:text-foreground p-0.5"
              aria-label="Copy code"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            </button>
            <button
              onClick={() => setViewer('preview')}
              className="text-muted-foreground hover:text-foreground p-0.5"
              aria-label="Preview rendered output"
              title="Preview"
            >
              <Eye className="h-3 w-3" />
            </button>
            <button
              onClick={() => setViewer('inspect')}
              className="text-muted-foreground hover:text-foreground p-0.5"
              aria-label="Inspect raw code"
              title="Inspect with line numbers"
            >
              <Code className="h-3 w-3" />
            </button>
          </div>
        </div>
        <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto scrollbar-thin"><code>{code}</code></pre>
      </div>
      <CodeViewerDialog
        open={viewer !== null}
        onOpenChange={(o) => {
          if (!o) setViewer(null);
        }}
        language={language}
        code={code}
        mode={viewer ?? 'preview'}
      />
    </>
  );
}

/**
 * Extract the first triple-backtick code block from the assistant's content
 * so we can render it with syntax-friendly chrome. Everything else stays as
 * plain text.
 */
function splitCodeBlock(content: string): { body: string; code: { language: string; code: string } | null } {
  const match = /```(\w+)?\n([\s\S]*?)```/.exec(content);
  if (!match) {
    return { body: content, code: null };
  }
  const [full, lang, code] = match;
  return {
    body: content.replace(full, '').trim(),
    code: { language: lang ?? 'txt', code },
  };
}

function splitThinkingBlock(content: string): { thinking: string; body: string } {
  let thinking = '';
  let body = '';
  const startIdx = content.indexOf('<thinking>');
  if (startIdx !== -1) {
    const endIdx = content.indexOf('</thinking>');
    if (endIdx !== -1) {
      thinking = content.substring(startIdx + 10, endIdx);
      body = content.substring(0, startIdx) + content.substring(endIdx + 11);
    } else {
      thinking = content.substring(startIdx + 10);
      body = content.substring(0, startIdx);
    }
  } else {
    body = content;
  }
  return { thinking: thinking.trim(), body: body.trim() };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents < 100 ? 4 : 2)}`;
}

function extractMentionTarget(input: string, agents: Array<{ id: string; name: string }>) {
  const mentions = [...input.matchAll(/(^|\s)@([\w-]+)/g)];
  for (const match of mentions) {
    const handle = match[2]?.toLowerCase();
    const agent = agents.find(
      (candidate) =>
        candidate.name.toLowerCase() === handle || candidate.id.toLowerCase() === handle,
    );
    if (agent) {
      return {
        agentId: agent.id,
        content: input.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
      };
    }
  }
  return null;
}

/**
 * Tool results that come back as `{"ok": false, "error": "...", "hint": "..."}`
 * deserve a friendly first-line message instead of dumping the JSON straight
 * into the operator's face. Returns `null` if the result isn't an error-shaped
 * object, in which case the caller falls back to the raw JsonViewer.
 */
function extractFriendlyError(value: unknown): { message: string; hint?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const isError = obj.ok === false || typeof obj.error === 'string';
  if (!isError) return null;
  const message =
    typeof obj.error === 'string'
      ? obj.error
      : typeof obj.message === 'string'
        ? obj.message
        : 'Tool returned an error.';
  const hint = typeof obj.hint === 'string' ? obj.hint : undefined;
  return { message, hint };
}

/**
 * Inline tool-call bubble used by [`MessageSegments`] when rendering a
 * live stream. Same styling as [`ToolCallList`]'s rows but standalone so
 * it can sit between two text spans in arrival order.
 */
function InlineToolCall({ seg }: { readonly seg: Extract<ChatSegment, { kind: 'tool' }> }) {
  const statusColor =
    seg.status === 'error'
      ? 'text-destructive'
      : seg.status === 'running'
        ? 'text-warning'
        : 'text-primary';
  const statusLabel =
    seg.status === 'running'
      ? '⏵ running'
      : seg.status === 'error'
        ? '✕ error'
        : '✓ ok';
  return (
    <details
      className="my-2 rounded-md border border-border bg-surface-2 px-3 py-2"
      open={seg.status === 'error' || seg.status === 'running'}
      aria-label={`Tool call: ${seg.tool}`}
    >
      <summary className={`cursor-pointer text-xs font-mono ${statusColor} flex items-center gap-2`}>
        <span>{seg.tool}</span>
        <span className="text-micro opacity-80">{statusLabel}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {seg.error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-micro text-destructive">
            {seg.error}
          </div>
        )}
        {(() => {
          const friendly = extractFriendlyError(seg.result);
          if (!friendly) return null;
          return (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive space-y-1">
              <div className="font-medium">{friendly.message}</div>
              {friendly.hint && (
                <div className="text-muted-foreground text-micro">{friendly.hint}</div>
              )}
            </div>
          );
        })()}
        {seg.args !== undefined && (
          <JsonViewer value={seg.args} label="arguments" previewChars={240} />
        )}
        {seg.result !== undefined && (
          <JsonViewer
            value={seg.result}
            label={extractFriendlyError(seg.result) ? 'Inspect raw' : 'result'}
            previewChars={320}
          />
        )}
      </div>
    </details>
  );
}

/**
 * Render an assistant message in arrival order: each text segment as a
 * paragraph, each tool segment as an inline collapsible bubble between
 * the surrounding text. This is the causal-honesty rendering the plan
 * called out — the previous "all text, then all tools at the bottom"
 * approach broke the user's mental model of what happened when.
 *
 * Only used while a message is still streaming (segments live in
 * `useChatStream`); persisted messages fall back to the legacy
 * "body + ToolCallList" layout because the backend doesn't yet store
 * segment order (it stores `content: string` and `toolCalls: array`).
 */
function MessageSegments({
  segments,
  isStreaming,
}: {
  readonly segments: ChatSegment[];
  readonly isStreaming: boolean;
}) {
  if (segments.length === 0) {
    return isStreaming ? <span className="opacity-50">…</span> : null;
  }
  return (
    <div className="text-sm whitespace-pre-wrap leading-relaxed">
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') {
          // Show the streaming caret only on the very last text segment
          // (because the model is still appending characters there).
          const isLastTextStreaming =
            isStreaming &&
            idx === segments.length - 1 &&
            seg.kind === 'text';
          return (
            <span key={`seg-${idx}`}>
              {seg.content}
              {isLastTextStreaming && <span className="inline-block ml-0.5 animate-pulse">▊</span>}
            </span>
          );
        }
        return <InlineToolCall key={`seg-${idx}`} seg={seg} />;
      })}
    </div>
  );
}

function ToolCallList({ toolCalls }: { readonly toolCalls: ToolCallTrace[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {toolCalls.map((call, index) => {
        const statusColor =
          call.status === 'error'
            ? 'text-destructive'
            : call.status === 'running'
              ? 'text-warning'
              : 'text-primary';
        const statusLabel =
          call.status === 'running'
            ? '⏵ running'
            : call.status === 'error'
              ? '✕ error'
              : call.status === 'ok'
                ? '✓ ok'
                : null;
        return (
          <details
            key={`${call.tool}-${index}`}
            className="rounded-md border border-border bg-surface-2 px-3 py-2"
            open={call.status === 'error'}
            aria-label={`Tool call: ${call.tool}`}
          >
            <summary className={`cursor-pointer text-xs font-mono ${statusColor} flex items-center gap-2`}>
              <span>{call.tool}</span>
              {statusLabel && <span className="text-micro opacity-80">{statusLabel}</span>}
            </summary>
            <div className="mt-2 space-y-2">
              {call.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-micro text-destructive">
                  {call.error}
                </div>
              )}
              {(() => {
                const friendly = extractFriendlyError(call.result);
                if (!friendly) return null;
                return (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive space-y-1">
                    <div className="font-medium">{friendly.message}</div>
                    {friendly.hint && (
                      <div className="text-muted-foreground text-micro">{friendly.hint}</div>
                    )}
                  </div>
                );
              })()}
              {call.arguments !== undefined && (
                <JsonViewer value={call.arguments} label="arguments" previewChars={240} />
              )}
              {call.result !== undefined && (
                <JsonViewer
                  value={call.result}
                  label={extractFriendlyError(call.result) ? 'Inspect raw' : 'result'}
                  previewChars={320}
                />
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function MessageAttachments({ messageId }: { readonly messageId: string }) {
  const query = useChatAttachments(messageId);
  const attachments = query.data ?? [];
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((att) => (
        <AttachmentChip key={att.id} attachment={att} messageId={messageId} />
      ))}
    </div>
  );
}

function AttachmentChip({
  attachment,
  messageId,
}: {
  readonly attachment: ChatAttachment;
  readonly messageId: string;
}) {
  const url = attachmentDownloadUrl(messageId, attachment.id);
  if (attachment.kind === 'image') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded-md overflow-hidden border border-border max-w-[200px]"
      >
        <img
          src={url}
          alt={attachment.name}
          className="block max-h-40 w-auto object-cover"
          loading="lazy"
        />
      </a>
    );
  }
  const Icon =
    attachment.kind === 'text'
      ? FileText
      : attachment.mimeType.startsWith('image/')
        ? ImageIcon
        : FileBox;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs hover:bg-surface-3"
    >
      <Icon className="h-3 w-3 text-muted-foreground" aria-hidden />
      <span className="font-mono">{attachment.name}</span>
      <span className="text-muted-foreground">
        {Math.round(attachment.bytesSize / 1024)} KB
      </span>
    </a>
  );
}

export default function ChatCentral() {
  const { state } = useHiveData();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectId = state.activeProjectId;

  const threadsQuery = useChatThreads(projectId);
  const threads: ChatThread[] = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showNewPill, setShowNewPill] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const { chatTargetAgentId, setChatTargetAgentId, defaultModel } = useWorkspace();

  const createThreadMutation = useCreateChatThread();
  const deleteThreadMutation = useDeleteChatThread();
  const compactThreadMutation = useCompactChatThread();
  const cancelMutation = useCancelChatMessage();

  // Pick the first thread once loaded.
  useEffect(() => {
    if (!activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  // Deep-link: when another page asks to focus an agent's thread, create it
  // if needed and switch.
  useEffect(() => {
    if (!chatTargetAgentId || !projectId) return;
    const existing = threads.find((t) => t.agentId === chatTargetAgentId);
    if (existing) {
      setActiveThreadId(existing.id);
      setChatTargetAgentId(null);
      return;
    }
    // C316: the mutation object's identity changes as its state transitions,
    // re-running this effect while the create is still in flight — without
    // this guard a second (duplicate) thread was created for the same agent.
    if (createThreadMutation.isPending) return;
    const agent = state.agents.find((a) => a.id === chatTargetAgentId);
    createThreadMutation.mutate(
      {
        projectId,
        agentId: chatTargetAgentId,
        title: agent?.name ?? 'Agent',
      },
      {
        onSuccess: (thread) => {
          setActiveThreadId(thread.id);
          setChatTargetAgentId(null);
        },
      }
    );
  }, [chatTargetAgentId, projectId, threads, state.agents, createThreadMutation, setChatTargetAgentId]);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const messagesQuery = useChatMessages(activeThreadId);
  const streaming = useChatStream(activeThreadId);
  const sendMutation = useSendChatMessage(activeThreadId);
  const uploadAttachments = useUploadChatAttachments();
  const processMessage = useProcessChatMessage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // Assemble the render list: merge persisted messages with any in-flight
  // streaming content (assistant chunks not yet finalized in DB).
  //
  // We attach `liveSegments` (non-persisted) on top of each ChatMessage so
  // the JSX below can render text + tool calls in arrival order
  // (causal honesty). Persisted messages don't carry segments — the
  // backend stores `content: string` and `toolCalls: array` so we lose
  // ordering at finalize time; for those we fall back to the legacy
  // body + ToolCallList layout.
  type RenderMessage = ChatMessage & { liveSegments?: ChatSegment[] };
  const renderMessages = useMemo<RenderMessage[]>(() => {
    return messages.map((m) => {
      const live = streaming[m.id];
      if (live && m.status !== 'done') {
        // Keep the flat toolCalls fallback for the (legacy) ToolCallList
        // path, but also surface the live segments so the renderer below
        // can use them when present.
        const liveToolCalls: ToolCallTrace[] = live.segments
          .filter((s): s is Extract<typeof live.segments[number], { kind: 'tool' }> => s.kind === 'tool')
          .map((s) => ({
            tool: s.tool,
            arguments: s.args,
            result: s.result,
            error: s.error,
            status: s.status,
          }));
        return {
          ...m,
          content: live.content || m.content,
          toolCalls: liveToolCalls.length > 0 ? liveToolCalls : m.toolCalls,
          tokensIn: live.tokensIn ?? m.tokensIn,
          tokensOut: live.tokensOut ?? m.tokensOut,
          costCents: live.costCents ?? m.costCents,
          liveSegments: live.segments,
        };
      }
      return m;
    });
  }, [messages, streaming]);

  const inFlightAssistant = renderMessages.find(
    (m) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending')
  );

  const mentionMatch = /(?:^|\s)@([\w-]*)$/.exec(input);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? '';
  const mentionOptions = mentionMatch
    ? state.agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(mentionQuery) || agent.id.toLowerCase().includes(mentionQuery)
      )
    : [];

  const tokenEstimate = Math.max(1, Math.round(input.length * 1.3));

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    if (!showNewPill) scrollToBottom();
  }, [renderMessages.length, showNewPill]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowNewPill(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  };

  const handleSlashCommand = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/')) return false;
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help': {
        toast.info(
          'Slash commands: /help · /clear (delete current thread) · /new [title] · /compact (summarize older messages) · /model (open picker)',
          { duration: 8000 },
        );
        setInput('');
        return true;
      }
      case 'clear': {
        if (activeThreadId) {
          deleteThreadMutation.mutate(activeThreadId);
          setActiveThreadId(null);
        }
        setInput('');
        return true;
      }
      case 'new': {
        if (!projectId) return true;
        createThreadMutation.mutate(
          { projectId, title: arg || `Thread ${threads.length + 1}` },
          { onSuccess: (t) => setActiveThreadId(t.id) },
        );
        setInput('');
        return true;
      }
      case 'model': {
        setShowModelPicker(true);
        setInput('');
        return true;
      }
      case 'compact': {
        if (!activeThreadId) {
          toast.error('Open a thread first.');
        } else {
          toast.promise(compactThreadMutation.mutateAsync(activeThreadId), {
            loading: 'Compacting thread…',
            success: (r) =>
              r.summarizedCount > 0
                ? `Compacted ${r.summarizedCount} older message(s) into a summary.`
                : (r.message ?? 'Nothing to compact.'),
            error: (e) => (e instanceof Error ? e.message : 'Compaction failed.'),
          });
        }
        setInput('');
        return true;
      }
      default: {
        toast.error(`Unknown command: /${cmd}. Type /help for a list.`);
        return true;
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !activeThreadId || sendMutation.isPending || createThreadMutation.isPending) return;
    if (handleSlashCommand(input)) return;
    const route = extractMentionTarget(input.trim(), state.agents);
    const content = route?.content || input.trim();
    if (!content) return;

    let targetThreadId = activeThreadId;
    if (route?.agentId) {
      const existing = threads.find((thread) => thread.agentId === route.agentId);
      if (existing) {
        targetThreadId = existing.id;
      } else if (projectId) {
        const agent = state.agents.find((candidate) => candidate.id === route.agentId);
        const created = await createThreadMutation.mutateAsync({
          projectId,
          agentId: route.agentId,
          title: agent?.name ?? 'Agent',
        });
        targetThreadId = created.id;
      }
      setActiveThreadId(targetThreadId);
    }

    const filesToUpload = pendingFiles;
    const useDeferred = filesToUpload.length > 0;
    try {
      const sent = await sendMutation.mutateAsync({
        threadId: targetThreadId,
        content,
        model: modelOverride ?? defaultModel ?? null,
        defer: useDeferred,
      });
      setInput('');
      setPendingFiles([]);
      if (useDeferred) {
        // Upload to the user message, then kick off the runtime.
        try {
          await uploadAttachments.mutateAsync({
            messageId: sent.userMessage.id,
            files: filesToUpload,
          });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Attachment upload failed',
          );
          // Best effort: still process the message so the user gets a
          // reply, just without the attachments.
        }
        await processMessage.mutateAsync(sent.assistantMessage.id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Send failed');
    }
  };

  const handlePickFiles = () => fileInputRef.current?.click();
  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const next = [...pendingFiles, ...files].slice(0, 5);
    if (files.length > 5 - pendingFiles.length) {
      toast.warning('At most 5 attachments per message');
    }
    setPendingFiles(next);
    event.target.value = '';
  };
  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCancel = () => {
    if (inFlightAssistant) {
      cancelMutation.mutate(inFlightAssistant.id);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleMentionInsert = (agentName: string) => {
    setInput((current) => current.replace(/(?:^|\s)@([\w-]*)$/, ` @${agentName} `).trimStart());
    textareaRef.current?.focus();
  };

  const handleNewThread = () => {
    if (!projectId) return;
    createThreadMutation.mutate(
      { projectId, title: `Thread ${threads.length + 1}` },
      { onSuccess: (t) => setActiveThreadId(t.id) }
    );
  };

  const totalCostCents = renderMessages.reduce((sum, m) => sum + (m.costCents ?? 0), 0);
  const totalTokens = renderMessages.reduce((sum, m) => sum + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0);

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>Select a project to start chatting.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* Sidebar for threads */}
      <div className="w-64 shrink-0 flex flex-col border-r border-border bg-surface-2 overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Conversations</span>
          <div className="flex gap-1">
            <button
              onClick={() => setCompactMode(c => !c)}
              className={cn("p-1.5 rounded-md hover:bg-surface-3 text-muted-foreground transition-colors", compactMode && "text-primary")}
              title="Toggle Compact Mode"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleNewThread}
              className="p-1.5 rounded-md hover:bg-surface-3 text-muted-foreground hover:text-foreground transition-colors"
              title="New thread"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-4">
          {/* Group threads by agent */}
          {Array.from(new Set(threads.map(t => t.agentId))).map(agentId => {
            const agent = agentId ? state.agents.find((a) => a.id === agentId) : null;
            const agentThreads = threads.filter(t => t.agentId === agentId);
            return (
              <div key={agentId ?? 'global'} className="space-y-1">
                <div className="flex items-center gap-1.5 px-2 py-1 mb-1">
                  {agent ? <StatusDot status={agent.status} size="sm" /> : <Hexagon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-xs font-semibold truncate">{agent ? agent.name : 'Project Threads'}</span>
                </div>
                {agentThreads.map((thread) => (
                  <div key={thread.id} className="group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-surface-3 relative">
                    <button
                      onClick={() => setActiveThreadId(thread.id)}
                      className={cn(
                        'flex-1 text-left truncate',
                        activeThreadId === thread.id ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {thread.title}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteThreadMutation.mutate(thread.id);
                        if (activeThreadId === thread.id) setActiveThreadId(null);
                      }}
                      aria-label="Delete thread" className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-muted-foreground hover:text-destructive rounded hover:bg-surface-2 absolute right-1 bg-surface-3"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className={cn("flex-1 overflow-auto scrollbar-thin p-4 space-y-4 relative", compactMode && "p-2 space-y-2")}>
          {messagesQuery.isLoading && (
            <div className="text-center text-xs text-muted-foreground">Loading messages…</div>
          )}

          {!messagesQuery.isLoading && renderMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-6">
              <div className="rounded-full bg-surface-2 p-4 mb-4">
                <Hexagon className="h-8 w-8 text-primary" fill="currentColor" />
              </div>
              <h3 className="text-sm font-semibold mb-1">Start a conversation with the hive</h3>
              <p className="text-xs text-muted-foreground max-w-sm">
                Ask a question, mention an agent with @name, or attach a file to get started.
              </p>
            </div>
          )}

          {renderMessages.map((message) => {
            if (message.role === 'system') {
              return (
                <motion.div key={message.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-micro text-muted-foreground">{message.content}</span>
                </motion.div>
              );
            }

            const isUser = message.role === 'user';
            const { thinking, body: contentAfterThinking } = splitThinkingBlock(message.content);
            const { body, code } = splitCodeBlock(contentAfterThinking);
            const isStreaming = message.status === 'streaming' || message.status === 'pending';
            const isCancelled = message.status === 'cancelled';
            const isError = message.status === 'error';

            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex gap-3 max-w-[80%]', isUser ? 'ml-auto flex-row-reverse' : '')}
              >
                {!isUser && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Hexagon className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className={cn('rounded-lg px-4 py-2.5', isUser ? 'bg-primary/10 text-foreground' : 'bg-card border border-border')}>
                  {thinking && (
                    <details className="mb-2 rounded-md border border-border bg-surface-2 px-3 py-2" open={isStreaming}>
                      <summary className="cursor-pointer text-xs font-mono text-muted-foreground select-none opacity-80 hover:opacity-100">
                        Agent Reasoning
                      </summary>
                      <div className="mt-2 text-xs italic text-muted-foreground whitespace-pre-wrap border-l-2 border-primary/20 pl-3 ml-1 mb-1">
                        {thinking}
                        {isStreaming && !body && <span className="inline-block ml-0.5 animate-pulse">▊</span>}
                      </div>
                    </details>
                  )}
                  {/* Inline interleave when streaming (segments are alive). For
                      persisted messages the segments don't survive backend
                      finalize, so we fall back to body + ToolCallList. */}
                  {message.liveSegments && message.liveSegments.length > 0 ? (
                    <MessageSegments segments={message.liveSegments} isStreaming={isStreaming} />
                  ) : (
                    <>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {body || (isStreaming && !thinking ? <span className="opacity-50">…</span> : null)}
                        {isStreaming && body && <span className="inline-block ml-0.5 animate-pulse">▊</span>}
                      </div>
                      <ToolCallList toolCalls={message.toolCalls ?? []} />
                    </>
                  )}
                {code && <CodeBlock language={code.language} code={code.code} />}
                {isUser && <MessageAttachments messageId={message.id} />}
                {!isUser ? (
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <MetadataFooter
                      model={message.model}
                      providerId={message.providerId}
                      tokensIn={message.tokensIn}
                      tokensOut={message.tokensOut}
                      costCents={message.costCents}
                      timestamp={message.createdAt}
                      status={message.status}
                    />
                    {isError && (
                      <button
                        type="button"
                        onClick={() => {
                          processMessage.mutate(message.id, {
                            onSuccess: () => toast.success('Retrying…'),
                            onError: (e) => toast.error(e instanceof Error ? e.message : 'Retry failed'),
                          });
                        }}
                        disabled={processMessage.isPending}
                        className="flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-0.5 text-micro text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        aria-label="Retry message"
                      >
                        <RefreshCcw className="h-3 w-3" /> Retry
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-micro text-muted-foreground font-mono">{formatTimestamp(message.createdAt)}</span>
                    {isCancelled && <span className="text-micro text-warning">cancelled</span>}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}

        <AnimatePresence>
          {showNewPill && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={scrollToBottom}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg z-10"
            >
              <ArrowDown className="h-3 w-3" />
              New messages
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Cost footer */}
      <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 border border-border px-3 py-2 mx-4 mb-2">
        <span className="text-xs text-muted-foreground">
          {renderMessages.length} messages · {totalTokens} tok · {centsToDollars(totalCostCents)}
        </span>
        {sendMutation.isError && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {(sendMutation.error as Error)?.message}
          </span>
        )}
      </div>

      {/* Model picker (collapsible) */}
      {showModelPicker && (
        <div className="border-t border-border bg-card/50 px-4 py-3">
          <div className="text-xs text-muted-foreground mb-2">Model for next message:</div>
          <ModelPicker value={modelOverride ?? defaultModel ?? null} onChange={setModelOverride} />
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-border p-4 relative">
        {mentionOptions.length > 0 && (
          <div className="absolute bottom-full mb-2 left-14 w-72 rounded-lg border border-border bg-card p-2 shadow-xl">
            {mentionOptions.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleMentionInsert(agent.name)}
                className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs text-left hover:bg-surface-2"
              >
                <StatusDot status={agent.status} size="sm" />
                <span className="flex-1">{agent.name}</span>
                <span className="text-micro text-muted-foreground font-mono">{agent.role}</span>
              </button>
            ))}
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2 mb-2">
            {pendingFiles.map((file, idx) => (
              <span
                key={`${file.name}-${idx}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs"
              >
                {file.type.startsWith('image/') ? (
                  <ImageIcon className="h-3 w-3 text-info" aria-hidden />
                ) : file.type.startsWith('text/') || file.type === 'application/json' ? (
                  <FileText className="h-3 w-3 text-success" aria-hidden />
                ) : (
                  <FileBox className="h-3 w-3 text-muted-foreground" aria-hidden />
                )}
                <span className="font-mono">{file.name}</span>
                <span className="text-muted-foreground">
                  ({Math.round(file.size / 1024)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => removePendingFile(idx)}
                  aria-label={`Remove ${file.name}`}
                  className="text-muted-foreground hover:text-destructive ml-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <span className="text-micro text-muted-foreground self-center">
              {pendingFiles.length}/5 — uploaded with the next message
            </span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Mention agent">
            <AtSign className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handlePickFiles}
            className={cn(
              'p-1.5 transition-colors',
              pendingFiles.length > 0
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Attach file"
            title={pendingFiles.length > 0 ? `${pendingFiles.length} file(s) staged` : 'Attach file'}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            className={cn(
              'p-1.5 transition-colors',
              showModelPicker ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setShowModelPicker((open) => !open)}
            aria-label="Toggle model picker"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${activeThread?.title ?? 'the hive'}… (⌘Enter to send · /help for commands)`}
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[120px]"
            rows={1}
          />
          <div className="flex items-center gap-2">
            <span className="text-micro text-muted-foreground font-mono">{tokenEstimate} tok</span>
            {inFlightAssistant ? (
              <button
                onClick={handleCancel}
                className="rounded-md bg-warning/80 p-1.5 text-warning-foreground hover:bg-warning transition-colors"
                aria-label="Stop generating"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sendMutation.isPending || createThreadMutation.isPending || !activeThreadId}
                className="rounded-md bg-primary p-1.5 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
