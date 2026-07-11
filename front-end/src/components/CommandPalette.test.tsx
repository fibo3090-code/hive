import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Agent } from "@/types/domain";

// --- Mocks -----------------------------------------------------------
// CommandPalette pulls live data from useHiveData() and workspace setters
// from useWorkspace(). Neither is under test here (a separate agent owns
// the data-fetching layer), so we replace both with controllable fakes
// and keep react-router-dom's real MemoryRouter but override useNavigate
// so activation can be asserted without a real route tree.

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/api/queries/useHiveData", () => ({
  useHiveData: vi.fn(),
}));

vi.mock("@/context/WorkspaceContext", () => ({
  useWorkspace: vi.fn(),
}));

import { useHiveData } from "@/api/queries/useHiveData";
import { useWorkspace } from "@/context/WorkspaceContext";
import { CommandPalette } from "./CommandPalette";

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

const setChatTargetAgentId = vi.fn();
const setGraphFocusAgentId = vi.fn();
const setSelectedCommandId = vi.fn();

function renderPalette(agents: Agent[] = [agentFixture]) {
  vi.mocked(useHiveData).mockReturnValue({
    state: { agents },
  } as unknown as ReturnType<typeof useHiveData>);

  vi.mocked(useWorkspace).mockReturnValue({
    setChatTargetAgentId,
    setGraphFocusAgentId,
    setSelectedCommandId,
  } as unknown as ReturnType<typeof useWorkspace>);

  const utils = render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );

  // Open the palette the same way a user would: Cmd/Ctrl+K.
  fireEvent.keyDown(window, { key: "k", metaKey: true });

  return utils;
}

function getInput() {
  return screen.getByPlaceholderText("Search commands, agents, files...");
}

function typeQuery(value: string) {
  fireEvent.change(getInput(), { target: { value } });
}

// The item label also appears in the right-hand preview pane once
// selected, so item-presence assertions need to be scoped to the result
// list (role="listbox") to avoid ambiguous "multiple elements" matches.
function getList() {
  return screen.getByRole("listbox");
}

beforeAll(() => {
  // jsdom doesn't implement these; cmdk's <CommandList> observes its own
  // size, and Radix primitives poke at pointer-capture APIs during focus
  // management. None of that is what we're testing, so provide inert stubs
  // scoped to this file only.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

beforeEach(() => {
  navigateMock.mockReset();
  setChatTargetAgentId.mockReset();
  setGraphFocusAgentId.mockReset();
  setSelectedCommandId.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommandPalette", () => {
  it("opens on Cmd+K and lists both static commands and live agents", () => {
    renderPalette();

    expect(getInput()).toBeInTheDocument();
    expect(within(getList()).getByText("Go to Dashboard")).toBeInTheDocument();
    expect(within(getList()).getByText("Aria Researcher")).toBeInTheDocument();
  });

  it("closes again on a second Cmd/Ctrl+K toggle", () => {
    renderPalette();
    expect(screen.queryByPlaceholderText("Search commands, agents, files...")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.queryByPlaceholderText("Search commands, agents, files...")).not.toBeInTheDocument();
  });

  it("filters out items whose label doesn't fuzzy-match the query", () => {
    renderPalette();

    typeQuery("dash");

    expect(within(getList()).getByText("Go to Dashboard")).toBeInTheDocument();
    // "Go to Stats" has no letter 'd' at all, so it cannot match the 'dash'
    // subsequence under any fuzzy scoring and must disappear.
    expect(within(getList()).queryByText("Go to Stats")).not.toBeInTheDocument();
  });

  it("filters agents by name alongside static commands", () => {
    renderPalette();

    typeQuery("aria");

    expect(within(getList()).getByText("Aria Researcher")).toBeInTheDocument();
    expect(within(getList()).queryByText("Go to Dashboard")).not.toBeInTheDocument();
  });

  it("shows 'No results found' when nothing matches", () => {
    renderPalette();

    typeQuery("zzzzzznomatch");

    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("picks the best fuzzy match as the preview (word-start bonus ranks 'Go to Dashboard' first for 'gtd')", () => {
    renderPalette();

    typeQuery("gtd");

    // The preview pane always reflects filtered[selectedIndex] (reset to 0
    // on every query change), so this exercises bestFuzzyScore's ranking
    // without depending on cmdk's own internal DOM reordering.
    const previewHeading = screen.getByText("Go to Dashboard", { selector: ".text-lg" });
    expect(previewHeading).toBeInTheDocument();
  });

  it("ArrowDown moves the preview forward through the filtered list", () => {
    renderPalette();

    typeQuery("go to");
    const input = getInput();

    // Whatever the first item's preview title is, ArrowDown should move on
    // to a *different* item's preview (order itself is covered by the
    // dedicated ranking test above).
    const firstPreview = document.querySelector(".text-lg")?.textContent;

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const secondPreview = document.querySelector(".text-lg")?.textContent;

    expect(secondPreview).toBeTruthy();
    expect(secondPreview).not.toBe(firstPreview);
  });

  it("ArrowDown clamps at the last item and does not wrap around", () => {
    renderPalette();

    typeQuery("go to dashboard"); // narrows to effectively one strong match
    const input = getInput();

    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }

    // Should not throw / crash and the preview should still show a valid
    // item (not undefined), proving selectedIndex was clamped to
    // filtered.length - 1 rather than running off the end.
    expect(screen.getByText("Go to Dashboard", { selector: ".text-lg" })).toBeInTheDocument();
  });

  it("ArrowUp clamps at the first item and does not go negative", () => {
    renderPalette();

    typeQuery("go to");
    const input = getInput();

    for (let i = 0; i < 20; i += 1) {
      fireEvent.keyDown(input, { key: "ArrowUp" });
    }

    // Clamped at index 0 — still renders a concrete preview, no crash.
    const preview = document.querySelector(".text-lg")?.textContent;
    expect(preview).toBeTruthy();
  });

  it("Enter on a navigation item closes the palette and navigates to its path", () => {
    renderPalette();

    typeQuery("dashboard");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    expect(screen.queryByPlaceholderText("Search commands, agents, files...")).not.toBeInTheDocument();
  });

  it("Enter on an agent item opens the agent drawer instead of navigating", () => {
    renderPalette();

    typeQuery("aria");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText("Message Agent")).toBeInTheDocument();
    // Drawer header repeats the agent's name; just assert it's present.
    expect(screen.getAllByText("Aria Researcher").length).toBeGreaterThan(0);
  });

  it("clicking 'Message Agent' in the drawer sets the chat target and navigates to /chat", () => {
    renderPalette();

    typeQuery("aria");
    fireEvent.keyDown(getInput(), { key: "Enter" });

    fireEvent.click(screen.getByText("Message Agent"));

    expect(setChatTargetAgentId).toHaveBeenCalledWith("agent-1");
    expect(navigateMock).toHaveBeenCalledWith("/chat");
  });

  it("renders with an empty agent list without crashing (static commands only)", () => {
    renderPalette([]);

    expect(within(getList()).getByText("Go to Dashboard")).toBeInTheDocument();
    expect(within(getList()).queryByText("Aria Researcher")).not.toBeInTheDocument();
  });
});
