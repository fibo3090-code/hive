import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Project } from "@/types/domain";

// A sibling agent owns api/client.ts itself — here we only need `api` to be
// a controllable stand-in so useHiveData's query wiring (keys, `enabled`
// flags, invalidation on mutation success) can be exercised without a real
// network layer.
vi.mock("@/api/client", () => ({
  api: vi.fn(),
}));

import { api } from "@/api/client";
import { useHiveData } from "./useHiveData";

const project: Project = {
  id: "p1",
  name: "Proj One",
  description: "",
  healthScore: 80,
  agentCount: 1,
  budget: { used: 0, total: 100 },
  specCompletion: 0,
  testCoverage: 0,
  sovereigntyTier: "cloud",
  status: "active",
  lastActivity: "now",
};

function jsonOf<T>(value: T): T {
  return value;
}

/** Routes each mocked `api()` call by matching against the request path. */
function mockApiRoutes(overrides: Partial<Record<string, unknown>> = {}) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === "/v1/projects") return jsonOf(overrides.projects ?? []);
    if (path === "/v1/projects/active") return jsonOf(overrides.active ?? null);
    if (path.endsWith("/agents")) return jsonOf(overrides.agents ?? []);
    if (path.endsWith("/tasks")) return jsonOf(overrides.tasks ?? []);
    if (path.endsWith("/alerts")) return jsonOf(overrides.alerts ?? []);
    if (path.endsWith("/session")) return jsonOf(overrides.session ?? null);
    if (path === "/v1/notifications") return jsonOf(overrides.notifications ?? []);
    if (path.endsWith("/activate")) return jsonOf({ ok: true });
    if (path.endsWith("/read")) return jsonOf({ ok: true });
    throw new Error(`unmocked api() call: ${path}`);
  });
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useHiveData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to projects[0] as the active project and enables dependent queries once resolved", async () => {
    mockApiRoutes({
      projects: [project],
      active: null,
      agents: [{ id: "a1", name: "Agent One" }],
    });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useHiveData(), { wrapper });

    await waitFor(() => expect(result.current.state.activeProjectId).toBe("p1"));

    // Dependent queries (agents/tasks/alerts/session) only fire once a
    // project id is known — assert the agents endpoint was actually hit
    // for that project.
    await waitFor(() => {
      expect(vi.mocked(api)).toHaveBeenCalledWith("/v1/projects/p1/agents");
    });
  });

  it("does not call project-scoped endpoints when there is no active project", async () => {
    mockApiRoutes({ projects: [], active: null });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useHiveData(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.state.activeProjectId).toBeNull();
    expect(result.current.state.agents).toEqual([]);
    expect(result.current.state.session.isActive).toBe(false);

    const calledPaths = vi.mocked(api).mock.calls.map((call) => call[0]);
    expect(calledPaths.some((p) => typeof p === "string" && p.includes("/agents"))).toBe(false);
    expect(calledPaths.some((p) => typeof p === "string" && p.includes("/tasks"))).toBe(false);
    expect(calledPaths.some((p) => typeof p === "string" && p.includes("/alerts"))).toBe(false);
  });

  it("setActiveProject invalidates the project-scoped query keys on success", async () => {
    mockApiRoutes({ projects: [project], active: project });
    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useHiveData(), { wrapper });

    await waitFor(() => expect(result.current.state.activeProjectId).toBe("p1"));
    invalidateSpy.mockClear();

    await act(async () => {
      await result.current.setActiveProject("p1");
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["projects"]);
    expect(invalidatedKeys).toContainEqual(["projects", "active"]);
    expect(invalidatedKeys).toContainEqual(["notifications"]);
    expect(invalidatedKeys).toContainEqual(["settings"]);
  });

  it("markNotificationRead invalidates only the notifications key", async () => {
    mockApiRoutes({ projects: [project], active: project });
    const { wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useHiveData(), { wrapper });
    await waitFor(() => expect(result.current.state.activeProjectId).toBe("p1"));
    invalidateSpy.mockClear();

    await act(async () => {
      await result.current.markNotificationRead("n1");
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });
});
