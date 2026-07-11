import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Agent } from "@/types/domain";
import type { ChatMessage, ChatThread } from "@/api/chat";

// --- Mocks -----------------------------------------------------------
// ChatCentral is a big, heavily-coupled surface: it pulls project state
// from useHiveData(), workspace prefs from useWorkspace(), and every
// chat operation (threads/messages/streaming/mutations) from @/api/chat.
// None of those data layers are under test here (siblings own them), so
// all three are replaced with controllable fakes, following the pattern
// established in CommandPalette.test.tsx and useHiveData.test.tsx.
//
// useChatStream is part of @/api/chat and normally subscribes through
// RealtimeProvider; mocking the whole module sidesteps needing a real
// (or faked) realtime transport for these page-level flows.

vi.mock("@/api/queries/useHiveData", () => ({
  useHiveData: vi.fn(),
}));

vi.mock("@/context/WorkspaceContext", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/api/chat", () => ({
  useChatThreads: vi.fn(),
  useChatMessages: vi.fn(),
  useChatStream: vi.fn(),
  useCreateChatThread: vi.fn(),
  useDeleteChatThread: vi.fn(),
  useCompactChatThread: vi.fn(),
  useSendChatMessage: vi.fn(),
  useCancelChatMessage: vi.fn(),
  useChatAttachments: vi.fn(),
  useUploadChatAttachments: vi.fn(),
  useProcessChatMessage: vi.fn(),
  attachmentDownloadUrl: (messageId: string, attachmentId: string) => `/download/${messageId}/${attachmentId}`,
}));

import { useHiveData } from "@/api/queries/useHiveData";
import { useWorkspace } from "@/context/WorkspaceContext";
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
} from "@/api/chat";
import ChatCentral from "./ChatCentral";

const agentFixture: Agent = {
  id: "agent-1",
  projectId: "proj-1",
  slug: "aria-researcher",
  name: "Aria Researcher",
  role: "research",
  model: "claude-opus",
  status: "working",
  currentTask: "Investigate competitor pricing",
  tokensUsed: 1200,
  evalScores: {},
};

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "t1",
    projectId: "proj-1",
    agentId: null,
    title: "General",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    threadId: "t1",
    role: "user",
    content: "Hello",
    toolCalls: [],
    model: null,
    providerId: null,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    parentMessageId: null,
    status: "done",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Builds a fake react-query mutation object with spy-able mutate/mutateAsync. */
function fakeMutation<TArgs, TResult>(result: TResult) {
  const mutate = vi.fn();
  const mutateAsync = vi.fn().mockResolvedValue(result);
  return {
    mutate,
    mutateAsync,
    isPending: false,
    isError: false,
    error: null as unknown,
  } as unknown as {
    mutate: (args: TArgs, opts?: unknown) => void;
    mutateAsync: (args: TArgs) => Promise<TResult>;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
}

let createThreadMutation: ReturnType<typeof fakeMutation<unknown, ChatThread>>;
let deleteThreadMutation: ReturnType<typeof fakeMutation<string, void>>;
let sendMutation: ReturnType<typeof fakeMutation<unknown, { userMessage: ChatMessage; assistantMessage: ChatMessage }>>;

function setup({
  threads = [thread()],
  messages = [] as ChatMessage[],
  agents = [agentFixture],
  projectId = "proj-1",
}: {
  threads?: ChatThread[];
  messages?: ChatMessage[];
  agents?: Agent[];
  projectId?: string | null;
} = {}) {
  vi.mocked(useHiveData).mockReturnValue({
    state: { activeProjectId: projectId, agents },
  } as unknown as ReturnType<typeof useHiveData>);

  vi.mocked(useWorkspace).mockReturnValue({
    chatTargetAgentId: null,
    setChatTargetAgentId: vi.fn(),
    defaultModel: null,
  } as unknown as ReturnType<typeof useWorkspace>);

  vi.mocked(useChatThreads).mockReturnValue({ data: threads, isLoading: false } as unknown as ReturnType<typeof useChatThreads>);
  vi.mocked(useChatMessages).mockReturnValue({ data: messages, isLoading: false } as unknown as ReturnType<typeof useChatMessages>);
  vi.mocked(useChatStream).mockReturnValue({});

  createThreadMutation = fakeMutation<unknown, ChatThread>(thread({ id: "new-thread" }));
  vi.mocked(useCreateChatThread).mockReturnValue(createThreadMutation as unknown as ReturnType<typeof useCreateChatThread>);

  deleteThreadMutation = fakeMutation<string, void>(undefined);
  vi.mocked(useDeleteChatThread).mockReturnValue(deleteThreadMutation as unknown as ReturnType<typeof useDeleteChatThread>);

  vi.mocked(useCompactChatThread).mockReturnValue(fakeMutation<string, unknown>({}) as unknown as ReturnType<typeof useCompactChatThread>);

  sendMutation = fakeMutation<unknown, { userMessage: ChatMessage; assistantMessage: ChatMessage }>({
    userMessage: message({ id: "u1" }),
    assistantMessage: message({ id: "a1", role: "assistant" }),
  });
  vi.mocked(useSendChatMessage).mockReturnValue(sendMutation as unknown as ReturnType<typeof useSendChatMessage>);

  vi.mocked(useCancelChatMessage).mockReturnValue(fakeMutation<string, unknown>({}) as unknown as ReturnType<typeof useCancelChatMessage>);
  vi.mocked(useChatAttachments).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useChatAttachments>);
  vi.mocked(useUploadChatAttachments).mockReturnValue(fakeMutation<unknown, unknown>({}) as unknown as ReturnType<typeof useUploadChatAttachments>);
  vi.mocked(useProcessChatMessage).mockReturnValue(fakeMutation<string, unknown>({}) as unknown as ReturnType<typeof useProcessChatMessage>);

  return render(<ChatCentral />);
}

beforeAll(() => {
  // jsdom doesn't implement scrollTo; ChatCentral calls it on every
  // messages-length change to autoscroll the transcript. Stub it inertly,
  // scoped to this file only, same as CommandPalette.test.tsx does for
  // its own set of missing jsdom APIs.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatCentral", () => {
  it("shows a placeholder instead of the composer when there is no active project", () => {
    setup({ projectId: null });

    expect(screen.getByText("Select a project to start chatting.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Send message")).not.toBeInTheDocument();
  });

  it("renders the thread list grouped by agent, with static commands unaffected", () => {
    setup({
      threads: [thread({ id: "t1", title: "General" }), thread({ id: "t2", title: "Pricing research", agentId: "agent-1" })],
    });

    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Pricing research")).toBeInTheDocument();
    expect(screen.getByText("Aria Researcher")).toBeInTheDocument();
  });

  it("shows the empty-conversation state when the active thread has no messages", () => {
    setup({ threads: [thread({ id: "t1", title: "General" })], messages: [] });

    expect(screen.getByText("Start a conversation with the hive")).toBeInTheDocument();
  });

  it("auto-selects the first thread and reflects it in the composer placeholder", () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    expect(screen.getByPlaceholderText(/Message General/)).toBeInTheDocument();
  });

  it("selecting a different thread updates the active thread (composer placeholder changes)", () => {
    setup({
      threads: [thread({ id: "t1", title: "General" }), thread({ id: "t2", title: "Follow-ups" })],
    });

    expect(screen.getByPlaceholderText(/Message General/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Follow-ups"));

    expect(screen.getByPlaceholderText(/Message Follow-ups/)).toBeInTheDocument();
  });

  it("deleting a thread (C363) calls the delete mutation with that thread's id", () => {
    setup({
      threads: [thread({ id: "t1", title: "General" }), thread({ id: "t2", title: "Follow-ups" })],
    });

    fireEvent.click(screen.getAllByLabelText("Delete thread")[1]);

    expect(deleteThreadMutation.mutate).toHaveBeenCalledWith("t2");
  });

  it("deleting the currently active thread issues the delete mutation for that thread's id", () => {
    // Note: the mocked `threads` list is static (doesn't shrink after the
    // mutation fires), so the component's own "auto-select first thread"
    // effect immediately re-selects "t1" again — this test only asserts
    // the mutation call itself, not the transient selection-cleared state.
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    expect(screen.getByPlaceholderText(/Message General/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("Delete thread")[0]);

    expect(deleteThreadMutation.mutate).toHaveBeenCalledWith("t1");
  });

  it("the send button is disabled until there is text in the composer", () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    expect(screen.getByLabelText("Send message")).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Message General/), { target: { value: "hi there" } });

    expect(screen.getByLabelText("Send message")).not.toBeDisabled();
  });

  it("sending a message calls the send mutation with the thread id and trimmed content", async () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    fireEvent.change(screen.getByPlaceholderText(/Message General/), { target: { value: "  Hello agents  " } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(sendMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "t1", content: "Hello agents", defer: false }),
      ),
    );
  });

  it("sending clears the composer input on success", async () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    const textarea = screen.getByPlaceholderText(/Message General/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Hello agents" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("clicking the header '+' creates a new thread for the active project", () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    fireEvent.click(screen.getByTitle("New thread"));

    expect(createThreadMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", title: "Thread 2" }),
      expect.anything(),
    );
  });

  it("the /clear slash command deletes the active thread instead of sending a chat message", async () => {
    setup({ threads: [thread({ id: "t1", title: "General" })] });

    fireEvent.change(screen.getByPlaceholderText(/Message General/), { target: { value: "/clear" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(deleteThreadMutation.mutate).toHaveBeenCalledWith("t1"));
    expect(sendMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("renders persisted messages from useChatMessages", () => {
    setup({
      threads: [thread({ id: "t1", title: "General" })],
      messages: [message({ id: "m1", role: "user", content: "What is the project status?" })],
    });

    expect(screen.getByText("What is the project status?")).toBeInTheDocument();
  });
});
