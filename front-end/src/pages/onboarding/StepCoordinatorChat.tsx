/**
 * Onboarding step 4 (B1 — coordinator-led onboarding).
 *
 * The "Describe" step is no longer a plain textarea pretending to be the
 * CEO's interview — it is now an actual chat with the project's
 * Coordinator agent. The project itself was created at the entry to
 * this step (see `Onboarding.tsx::ensureProjectForChat`), so the
 * coordinator has somewhere to live.
 *
 * On mount we call `POST /v1/projects/:id/coordinator/converse` which
 * is idempotent: it ensures the coordinator agent exists and resolves
 * the canonical "CEO Onboarding" chat thread bound to it. After that
 * the conversation rides the standard chat infrastructure (`useChatMessages`,
 * `useSendChatMessage`, `useChatStream`) so this component stays small.
 *
 * `Skip — paste a brief instead` keeps the legacy textarea live as a
 * fallback for operators who don't want to chat. Anything typed there
 * flows into `onboardingDraft.description` exactly as it did before,
 * so `/launch` still sees a brief.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Hexagon, Send, Upload, MessagesSquare, FileText, ClipboardCheck, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import {
  useChatMessages,
  useChatStream,
  useSendChatMessage,
  type ChatMessage,
} from '@/api/chat';
import { Button } from '@/components/ui/button';
import { ModelPicker, type ModelSelection } from '@/components/shared/ModelPicker';
import { useWorkspace } from '@/context/WorkspaceContext';
import { cn } from '@/lib/utils';

interface ConverseResponse {
  threadId: string;
  coordinatorAgentId: string;
  threadTitle: string;
}

interface StepCoordinatorChatProps {
  /** The project created at step entry. The chat lives inside it. */
  readonly projectId: string | null;
  readonly teamMode: boolean;
  /** Persisted thread id so a refresh resumes the same conversation. */
  readonly coordinatorThreadId: string | null;
  readonly onThreadResolved: (threadId: string) => void;
  /** Legacy textarea fallback — typed brief that feeds `/launch`. */
  readonly description: string;
  readonly uploadedSpecName: string | null;
  readonly onDescriptionChange: (description: string) => void;
  readonly onSpecUpload: (file: { name: string; text: string }) => void;
}

export function StepCoordinatorChat({
  projectId,
  teamMode,
  coordinatorThreadId,
  onThreadResolved,
  description,
  uploadedSpecName,
  onDescriptionChange,
  onSpecUpload,
}: StepCoordinatorChatProps) {
  const [mode, setMode] = useState<'chat' | 'paste'>(coordinatorThreadId ? 'chat' : 'chat');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Resolve (or create) the coordinator + onboarding thread on mount.
  // Guarded so React StrictMode's double-invoke doesn't create two
  // threads — `get_or_create_for_agent` server-side is idempotent so
  // a race resolves to the same row anyway, but skipping the second
  // call keeps the network quiet.
  const resolveStartedRef = useRef(false);
  useEffect(() => {
    if (!projectId || coordinatorThreadId || resolveStartedRef.current) return;
    resolveStartedRef.current = true;
    setResolving(true);
    api<ConverseResponse>(`/v1/projects/${projectId}/coordinator/converse`, {
      method: 'POST',
      body: JSON.stringify({ teamMode }),
    })
      .then((res) => {
        onThreadResolved(res.threadId);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Could not reach the coordinator';
        setResolveError(msg);
      })
      .finally(() => setResolving(false));
  }, [projectId, coordinatorThreadId, teamMode, onThreadResolved]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-display-sm">Describe Your Project</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === 'chat'
            ? 'Talk it through with the Coordinator. It will ask follow-up questions and turn the conversation into a spec.'
            : 'Paste a brief or upload a spec document — skip the chat.'}
        </p>
      </div>

      <div className="flex justify-center">
        <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('chat')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded',
              mode === 'chat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <MessagesSquare className="h-3.5 w-3.5" /> Chat with CEO
          </button>
          <button
            type="button"
            onClick={() => setMode('paste')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded',
              mode === 'paste' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FileText className="h-3.5 w-3.5" /> Skip — paste a brief
          </button>
        </div>
      </div>

      {mode === 'chat' ? (
        <CoordinatorChatPanel
          threadId={coordinatorThreadId}
          resolving={resolving}
          resolveError={resolveError}
          teamMode={teamMode}
          description={description}
          onDescriptionChange={onDescriptionChange}
        />
      ) : (
        <PasteBriefPanel
          description={description}
          uploadedSpecName={uploadedSpecName}
          onDescriptionChange={onDescriptionChange}
          onSpecUpload={onSpecUpload}
        />
      )}
    </div>
  );
}

// ─── Chat panel ─────────────────────────────────────────────────────────────

function CoordinatorChatPanel({
  threadId,
  resolving,
  resolveError,
  teamMode,
  description,
  onDescriptionChange,
}: {
  readonly threadId: string | null;
  readonly resolving: boolean;
  readonly resolveError: string | null;
  readonly teamMode: boolean;
  readonly description: string;
  readonly onDescriptionChange: (description: string) => void;
}) {
  const messagesQuery = useChatMessages(threadId);
  const streaming = useChatStream(threadId);
  const sendMessage = useSendChatMessage(threadId);
  const [input, setInput] = useState('');
  const { defaultModel } = useWorkspace();
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Memo the source data so React's exhaustive-deps check on `renderMessages`
  // sees stable identities even when the upstream query refetches.
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // Merge live streaming content onto the pending assistant placeholder so
  // the user sees text appear in real time during the turn.
  const renderMessages: ChatMessage[] = useMemo(
    () =>
      messages.map((m) => {
        const live = streaming[m.id];
        if (live && m.status !== 'done') {
          return { ...m, content: live.content || m.content };
        }
        return m;
      }),
    [messages, streaming],
  );

  // Auto-scroll to bottom when a new message lands or content streams in.
  // Extract the latest-content snapshot into a stable dep so the
  // exhaustive-deps lint doesn't trip on the inline index expression.
  const lastContent = renderMessages[renderMessages.length - 1]?.content;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [renderMessages.length, lastContent]);

  // Derive a brief from the conversation: the operator's intent is what
  // *they* said, not what the model echoed back. Join user messages in
  // arrival order. This is the text that feeds `/launch`'s decomposition
  // when the user advances.
  const derivedBrief = useMemo(
    () =>
      messages
        .filter((m) => m.role === 'user' && m.content.trim())
        .map((m) => m.content.trim())
        .join('\n\n'),
    [messages],
  );
  const briefSynced =
    derivedBrief.length > 0 && derivedBrief === description.trim();

  // Auto-save the brief on every user message landing — keeps the draft's
  // `description` in sync without forcing the operator to remember a
  // button. They can still edit manually in the "Skip — paste a brief"
  // panel; doing so freezes the auto-sync until they switch back.
  useEffect(() => {
    if (!derivedBrief) return;
    if (description.trim() === derivedBrief) return;
    // Only auto-sync when description is empty or already matches an
    // earlier auto-sync (= empty or a strict prefix of the new brief).
    // If the operator typed their own brief, leave it alone.
    if (description.trim() === '' || derivedBrief.startsWith(description.trim())) {
      onDescriptionChange(derivedBrief);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedBrief]);

  const saveBrief = () => {
    if (!derivedBrief) {
      toast.error('Send at least one message first');
      return;
    }
    onDescriptionChange(derivedBrief);
    toast.success('Brief saved — proceed to Plan Review');
  };

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || !threadId || sendMessage.isPending) return;
    setInput('');
    try {
      await sendMessage.mutateAsync({
        content: trimmed,
        model: modelOverride ?? defaultModel ?? null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
      setInput(trimmed); // restore so the user doesn't lose what they typed
    }
  };

  if (resolveError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Could not reach the Coordinator: {resolveError}
        <div className="mt-2 text-xs text-muted-foreground">
          Switch to "Skip — paste a brief" above to continue, then retry the chat after launch.
        </div>
      </div>
    );
  }
  if (resolving || !threadId) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Spinning up the Coordinator…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card flex h-[min(620px,70vh)] min-h-[460px] flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-2 flex items-center justify-between bg-surface-2/40">
        <div className="flex items-center gap-2">
          <Hexagon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Coordinator</span>
          <span className={cn(
            'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
            teamMode ? 'bg-primary/10 text-primary' : 'bg-surface-3 text-muted-foreground',
          )}>
            Team mode: {teamMode ? 'ON' : 'OFF'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {briefSynced && (
            <span className="flex items-center gap-1 text-micro text-success">
              <ClipboardCheck className="h-3 w-3" /> brief synced
            </span>
          )}
          {!briefSynced && derivedBrief && (
            <button
              type="button"
              onClick={saveBrief}
              className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-micro hover:border-primary/40 hover:text-foreground"
              title="Persist the conversation as the brief that will feed /launch"
            >
              <ClipboardCheck className="h-3 w-3" /> Save as brief
            </button>
          )}
          <span className="text-micro text-muted-foreground">
            {messages.length} message{messages.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {renderMessages.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8 space-y-2">
            <p>Hi — I'm the Coordinator. Tell me what you want to build.</p>
            <p className="text-xs">
              Example: "A web app that lets indie game devs catalogue and rate
              the assets they use across projects."
            </p>
          </div>
        ) : (
          renderMessages.map((message) => {
            const isUser = message.role === 'user';
            const isStreaming = message.status === 'streaming' || message.status === 'pending';
            return (
              <div
                key={message.id}
                className={cn('flex gap-2 max-w-[85%]', isUser ? 'ml-auto flex-row-reverse' : '')}
              >
                {!isUser && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <Hexagon className="h-3 w-3 text-primary" />
                  </div>
                )}
                <div className={cn(
                  'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                  isUser ? 'bg-primary/10 text-foreground' : 'bg-surface-2 border border-border',
                )}>
                  {message.content || (isStreaming ? <span className="opacity-60">…</span> : null)}
                  {isStreaming && message.content && (
                    <span className="inline-block ml-0.5 animate-pulse">▊</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showModelPicker && (
        <div className="border-t border-border bg-card/80 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">
              Model for coordinator chat
            </div>
            <button
              type="button"
              onClick={() => setShowModelPicker(false)}
              className="rounded-md px-2 py-1 text-micro text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              Hide
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto pr-1 scrollbar-thin">
            <ModelPicker value={modelOverride ?? defaultModel ?? null} onChange={setModelOverride} />
          </div>
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-surface-2 p-2">
          <button
            type="button"
            onClick={() => setShowModelPicker((open) => !open)}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              showModelPicker ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Toggle coordinator model picker"
            title="Choose the model for the next Coordinator message"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Tell the Coordinator what you want to build… (⌘Enter to send)"
            className="min-h-[44px] max-h-[120px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            onClick={() => void submit()}
            disabled={!input.trim() || sendMessage.isPending}
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Paste-brief fallback (legacy textarea) ─────────────────────────────────

function PasteBriefPanel({
  description,
  uploadedSpecName,
  onDescriptionChange,
  onSpecUpload,
}: {
  readonly description: string;
  readonly uploadedSpecName: string | null;
  readonly onDescriptionChange: (description: string) => void;
  readonly onSpecUpload: (file: { name: string; text: string }) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Spec file too large (max 5 MB)');
      return;
    }
    try {
      const text = await file.text();
      onSpecUpload({ name: file.name, text });
      toast.success(`Loaded ${file.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to read file');
    }
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="relative">
        <textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2 p-3 pb-12 text-sm placeholder:text-muted-foreground resize-none h-40"
          placeholder="Type your brief, or upload a spec document…"
        />
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.markdown,.text"
            onChange={(event) => handleFileChange(event)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            title="Upload spec (.md, .txt)"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Spec
          </button>
          {uploadedSpecName && (
            <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
              {uploadedSpecName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
