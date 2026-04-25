import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Paperclip, AtSign, Hexagon, Copy, Eye, Code, AlertTriangle, ArrowDown, Check, Square, Plus, Settings2 } from 'lucide-react';
import { useHiveData } from '@/api/queries/useHiveData';
import { StatusDot } from '@/components/shared/StatusDot';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import {
  useChatThreads,
  useChatMessages,
  useChatStream,
  useCreateChatThread,
  useSendChatMessage,
  useCancelChatMessage,
  type ChatMessage,
  type ChatThread,
  type ToolCallTrace,
} from '@/api/chat';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

function CodeBlock({ language, code }: { readonly language: string; readonly code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface-2 mt-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 border-b border-border">
        <span className="text-micro font-mono text-muted-foreground">{language}</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              navigator.clipboard.writeText(code);
              setCopied(true);
              globalThis.setTimeout(() => setCopied(false), 1500);
            }}
            className="text-muted-foreground hover:text-foreground p-0.5"
            aria-label="Copy code"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
          <button className="text-muted-foreground hover:text-foreground p-0.5" aria-label="Preview">
            <Eye className="h-3 w-3" />
          </button>
          <button className="text-muted-foreground hover:text-foreground p-0.5" aria-label="Inspect">
            <Code className="h-3 w-3" />
          </button>
        </div>
      </div>
      <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto scrollbar-thin"><code>{code}</code></pre>
    </div>
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

function ToolCallList({ toolCalls }: { readonly toolCalls: ToolCallTrace[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {toolCalls.map((call, index) => (
        <details key={`${call.tool}-${index}`} className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <summary className="cursor-pointer text-xs font-mono text-primary">
            {call.tool}
          </summary>
          <div className="mt-2 space-y-2">
            {'arguments' in call && call.arguments !== undefined && (
              <pre className="overflow-x-auto text-micro text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(call.arguments, null, 2)}
              </pre>
            )}
            {'result' in call && call.result !== undefined && (
              <pre className="overflow-x-auto text-micro text-muted-foreground whitespace-pre-wrap">
                {JSON.stringify(call.result, null, 2)}
              </pre>
            )}
          </div>
        </details>
      ))}
    </div>
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
  const { chatTargetAgentId, setChatTargetAgentId, defaultModel } = useWorkspace();

  const createThreadMutation = useCreateChatThread();
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

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // Assemble the render list: merge persisted messages with any in-flight
  // streaming content (assistant chunks not yet finalized in DB).
  const renderMessages = useMemo<ChatMessage[]>(() => {
    return messages.map((m) => {
      const live = streaming[m.id];
      if (live && m.status !== 'done') {
        return {
          ...m,
          content: live.content || m.content,
          toolCalls: (live.toolCalls as ToolCallTrace[] | undefined) ?? m.toolCalls,
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

  const handleSend = async () => {
    if (!input.trim() || !activeThreadId || sendMutation.isPending || createThreadMutation.isPending) return;
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

    sendMutation.mutate(
      {
        threadId: targetThreadId,
        content,
        model: modelOverride ?? defaultModel ?? null,
      },
      {
        onSuccess: () => {
          setInput('');
        },
      },
    );
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
    <div className="flex flex-col h-full">
      {/* Thread tabs */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-2 overflow-x-auto scrollbar-thin">
        {threads.map((thread) => {
          const agent = thread.agentId ? state.agents.find((a) => a.id === thread.agentId) : null;
          return (
            <button
              key={thread.id}
              onClick={() => setActiveThreadId(thread.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs whitespace-nowrap transition-colors',
                activeThreadId === thread.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {agent ? <StatusDot status={agent.status} size="sm" /> : null}
              {thread.title}
            </button>
          );
        })}
        <button
          onClick={handleNewThread}
          className="flex items-center gap-1 rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="New thread"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto scrollbar-thin p-4 space-y-4 relative">
        {messagesQuery.isLoading && (
          <div className="text-center text-xs text-muted-foreground">Loading messages…</div>
        )}

        {!messagesQuery.isLoading && renderMessages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground mt-12">
            No messages yet. Ask the hive something to get started.
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
          const { body, code } = splitCodeBlock(message.content);
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
                {!isUser && message.model && (
                  <span className="text-micro font-medium text-primary block mb-1">
                    {message.providerId ?? 'model'} · {message.model}
                  </span>
                )}
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {body || (isStreaming ? <span className="opacity-50">…</span> : null)}
                  {isStreaming && <span className="inline-block ml-0.5 animate-pulse">▊</span>}
                </div>
                <ToolCallList toolCalls={message.toolCalls ?? []} />
                {code && <CodeBlock language={code.language} code={code.code} />}
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-micro text-muted-foreground font-mono">{formatTimestamp(message.createdAt)}</span>
                  {(message.tokensIn > 0 || message.tokensOut > 0) && (
                    <span className="text-micro text-muted-foreground font-mono">
                      {message.tokensIn + message.tokensOut} tok
                    </span>
                  )}
                  {message.costCents > 0 && (
                    <span className="text-micro text-muted-foreground font-mono">
                      {centsToDollars(message.costCents)}
                    </span>
                  )}
                  {isCancelled && <span className="text-micro text-warning">cancelled</span>}
                  {isError && <span className="text-micro text-destructive">error</span>}
                </div>
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

        <div className="flex items-end gap-2 rounded-lg border border-border bg-card p-2">
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Mention agent">
            <AtSign className="h-4 w-4" />
          </button>
          <button className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Attach file">
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
            placeholder={`Message ${activeThread?.title ?? 'the hive'}… (⌘Enter to send)`}
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
  );
}
