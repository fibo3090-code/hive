import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Agent, AlertItem, Project, TaskItem } from "@/types/domain";

// --- Mocks -----------------------------------------------------------
// Dashboard fans out to a lot of data hooks (useHiveData, several
// useServerData insight queries, usePlanGraph) plus react-router
// navigation. None of that data layer is under test here — a sibling
// agent owns it — so it's all replaced with controllable fakes, per the
// pattern in CommandPalette.test.tsx / useHiveData.test.tsx. The actual
// dashboard *layout* components (AlertBanners, DashboardMetrics, etc.)
// are left un-mocked and render for real since they're simple,
// props-only presentational components local to this page's feature
// area, not the shared UI/provider surface owned elsewhere.

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/api/queries/useHiveData", () => ({
  useHiveData: vi.fn(),
}));

vi.mock("@/api/queries/useServerData", () => ({
  useActivityFeedData: vi.fn(),
  useCostTimelineData: vi.fn(),
  useTaskDistributionData: vi.fn(),
  useAgentTokenUsageData: vi.fn(),
}));

vi.mock("@/api/planGraph", () => ({
  usePlanGraph: vi.fn(),
}));

import { useHiveData } from "@/api/queries/useHiveData";
import {
  useActivityFeedData,
  useCostTimelineData,
  useTaskDistributionData,
  useAgentTokenUsageData,
} from "@/api/queries/useServerData";
import { usePlanGraph } from "@/api/planGraph";
import Dashboard from "./Dashboard";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Atlas",
    description: "",
    healthScore: 82,
    agentCount: 2,
    budget: { used: 40, total: 100 },
    specCompletion: 60,
    testCoverage: 70,
    sovereigntyTier: "cloud",
    status: "active",
    lastActivity: "2m ago",
    ...overrides,
  };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    projectId: "p1",
    slug: "aria-researcher",
    name: "Aria Researcher",
    role: "research",
    model: "claude-opus",
    status: "working",
    currentTask: "Investigate competitor pricing",
    tokensUsed: 1200,
    evalScores: {},
    ...overrides,
  };
}

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    title: "Write onboarding spec",
    assignee: "Aria Researcher",
    status: "in-progress",
    priority: "high",
    estimatedTokens: 4000,
    ...overrides,
  };
}

function alert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: "alert-1",
    severity: "high",
    title: "Budget nearing limit",
    message: "80% of monthly budget consumed",
    timestamp: "2m ago",
    source: "budget-monitor",
    actionLabel: "Review",
    actionKind: "open_settings",
    ...overrides,
  };
}

const dismissAlert = vi.fn().mockResolvedValue(undefined);
const updateTaskStatus = vi.fn().mockResolvedValue(undefined);
const toggleSession = vi.fn().mockResolvedValue(undefined);

function mockHiveData({
  alerts = [] as AlertItem[],
  tasks = [] as TaskItem[],
  agents = [] as Agent[],
  activeProject = null as Project | null,
  budgetUsed = 0,
  budgetTotal = 0,
  healthScoreOverride,
}: {
  alerts?: AlertItem[];
  tasks?: TaskItem[];
  agents?: Agent[];
  activeProject?: Project | null;
  budgetUsed?: number;
  budgetTotal?: number;
  healthScoreOverride?: number;
} = {}) {
  vi.mocked(useHiveData).mockReturnValue({
    state: {
      alerts,
      tasks,
      agents,
      session: {
        isActive: true,
        agentCount: agents.length,
        elapsed: "00:12:00",
        tokensUsed: 5000,
        budgetUsed,
        budgetTotal,
      },
      healthScore: healthScoreOverride ?? activeProject?.healthScore ?? 0,
    },
    activeProject,
    dismissAlert,
    updateTaskStatus,
    toggleSession,
  } as unknown as ReturnType<typeof useHiveData>);
}

function mockServerData(overrides: {
  activityFeed?: unknown[];
  costTimeline?: unknown[];
  taskDistribution?: unknown[];
  agentTokenUsage?: unknown[];
} = {}) {
  vi.mocked(useActivityFeedData).mockReturnValue({ data: overrides.activityFeed ?? [] } as unknown as ReturnType<typeof useActivityFeedData>);
  vi.mocked(useCostTimelineData).mockReturnValue({ data: overrides.costTimeline ?? [] } as unknown as ReturnType<typeof useCostTimelineData>);
  vi.mocked(useTaskDistributionData).mockReturnValue({ data: overrides.taskDistribution ?? [] } as unknown as ReturnType<typeof useTaskDistributionData>);
  vi.mocked(useAgentTokenUsageData).mockReturnValue({ data: overrides.agentTokenUsage ?? [] } as unknown as ReturnType<typeof useAgentTokenUsageData>);
}

function mockPlanGraph(data: unknown = undefined) {
  vi.mocked(usePlanGraph).mockReturnValue({ data, isLoading: false } as unknown as ReturnType<typeof usePlanGraph>);
}

beforeAll(() => {
  // jsdom has no ResizeObserver; recharts' <ResponsiveContainer> (used for
  // the cost-timeline and token-usage charts) constructs one directly, so
  // without a stub the whole page throws on mount. Scoped to this file.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  navigateMock.mockReset();
  dismissAlert.mockClear();
  updateTaskStatus.mockClear();
  toggleSession.mockClear();
  mockPlanGraph(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("renders the empty state without crashing: zero tasks, zero agents, no alerts", () => {
    mockHiveData();
    mockServerData();

    render(<Dashboard />);

    expect(screen.getByText("System Overview")).toBeInTheDocument();
    expect(screen.getByText("0 tasks")).toBeInTheDocument();
    expect(screen.getByText("No sprint graph yet. Generate or decompose a spec from Planning.")).toBeInTheDocument();
  });

  it("renders health score and budget from the active project / session state", () => {
    mockHiveData({ activeProject: project({ healthScore: 82 }), budgetUsed: 40, budgetTotal: 100, healthScoreOverride: 82 });
    mockServerData();

    render(<Dashboard />);

    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("$40/$100")).toBeInTheDocument();
  });

  it("renders populated alerts, tasks, and agent cards from mocked useHiveData", () => {
    mockHiveData({
      alerts: [alert({ id: "a1", title: "Budget nearing limit" })],
      tasks: [task({ id: "t1", title: "Write onboarding spec" })],
      agents: [agent({ id: "agent-1", name: "Aria Researcher" })],
      activeProject: project(),
    });
    mockServerData();

    render(<Dashboard />);

    expect(screen.getByText("Budget nearing limit")).toBeInTheDocument();
    expect(screen.getByText("Write onboarding spec")).toBeInTheDocument();
    expect(screen.getAllByText("Aria Researcher").length).toBeGreaterThan(0);
    expect(screen.getByText("1 tasks")).toBeInTheDocument();
  });

  it("dismissing an alert without a navigable action calls dismissAlert with its id", () => {
    mockHiveData({ alerts: [alert({ id: "a1", actionKind: undefined, actionLabel: undefined })] });
    mockServerData();

    render(<Dashboard />);

    // The banner's own dismiss (X) button.
    const banner = screen.getByText("Budget nearing limit").closest("div.flex.items-center.gap-3");
    const dismissBtn = within(banner as HTMLElement).getAllByRole("button")[0];
    fireEvent.click(dismissBtn);

    expect(dismissAlert).toHaveBeenCalledWith("a1");
  });

  it("clicking an alert's action button navigates instead of dismissing (open_settings)", () => {
    mockHiveData({ alerts: [alert({ id: "a1", actionKind: "open_settings", actionLabel: "Review" })] });
    mockServerData();

    render(<Dashboard />);

    fireEvent.click(screen.getByText("Review"));

    expect(navigateMock).toHaveBeenCalledWith("/settings");
    expect(dismissAlert).not.toHaveBeenCalled();
  });

  it("toggling a queued task's status calls updateTaskStatus with the next status", () => {
    mockHiveData({ tasks: [task({ id: "t1", status: "queued" })] });
    mockServerData();

    render(<Dashboard />);

    // ActiveTasks renders one status-toggle button per task, before the
    // status label; grab it via its row.
    const row = screen.getByText("Write onboarding spec").closest("div.flex.items-center.gap-3");
    fireEvent.click(within(row as HTMLElement).getAllByRole("button")[0]);

    expect(updateTaskStatus).toHaveBeenCalledWith("t1", "in-progress");
  });

  it("clicking 'Forge Agent' navigates to /forge", () => {
    mockHiveData();
    mockServerData();

    render(<Dashboard />);

    fireEvent.click(screen.getByText("Forge Agent"));

    expect(navigateMock).toHaveBeenCalledWith("/forge");
  });

  it("clicking 'View Wake Report' on the background session card navigates to /session-history", () => {
    mockHiveData();
    mockServerData();

    render(<Dashboard />);

    fireEvent.click(screen.getByText("View Wake Report"));

    expect(navigateMock).toHaveBeenCalledWith("/session-history");
  });

  it("renders a populated cost-timeline / token-usage chart pair without crashing", () => {
    mockHiveData({ agents: [agent()] });
    mockServerData({
      costTimeline: [{ time: "2026-07-11T00:00:00Z", cents: 120, tokens: 500 }],
      agentTokenUsage: [{ agentId: "agent-1", tokens: 500 }],
      taskDistribution: [{ status: "completed", count: 3 }],
    });

    render(<Dashboard />);

    expect(screen.getByText("Cost Timeline")).toBeInTheDocument();
    expect(screen.getByText("Token Usage by Agent")).toBeInTheDocument();
  });
});
