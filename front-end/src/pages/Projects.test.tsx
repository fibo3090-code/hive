import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Project } from "@/types/domain";

// --- Mocks -----------------------------------------------------------
// Projects is the app entry point: it reads the project list from
// useHiveData() and navigates via react-router. Neither the data layer
// nor the router internals are under test here (a sibling agent owns
// the data-fetching layer and shared providers), so both are replaced
// with controllable fakes, following the pattern established in
// CommandPalette.test.tsx.

const navigateMock = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/api/queries/useHiveData", () => ({
  useHiveData: vi.fn(),
}));

import { useHiveData } from "@/api/queries/useHiveData";
import Projects from "./Projects";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Atlas",
    description: "Autonomous research pipeline",
    healthScore: 82,
    agentCount: 3,
    budget: { used: 40, total: 100 },
    specCompletion: 60,
    testCoverage: 70,
    sovereigntyTier: "cloud",
    status: "active",
    lastActivity: "2m ago",
    ...overrides,
  };
}

const setActiveProject = vi.fn().mockResolvedValue(undefined);
const deleteProject = vi.fn().mockResolvedValue(undefined);

function mockHiveData(projects: Project[], activeProject: Project | null = null) {
  vi.mocked(useHiveData).mockReturnValue({
    state: { projects },
    activeProject,
    setActiveProject,
    deleteProject,
  } as unknown as ReturnType<typeof useHiveData>);
}

function renderProjects(projects: Project[] = [project()], activeProject: Project | null = null) {
  mockHiveData(projects, activeProject);
  return render(
    <MemoryRouter>
      <Projects />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  setActiveProject.mockClear();
  deleteProject.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Projects", () => {
  it("renders the HIVE wordmark and the project list from useHiveData", () => {
    renderProjects([
      project({ id: "p1", name: "Atlas" }),
      project({ id: "p2", name: "Orion", healthScore: 45 }),
    ]);

    expect(screen.getByText("HIVE")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText("Orion")).toBeInTheDocument();
  });

  it("renders health score, budget, and agent count for a project card", () => {
    renderProjects([project({ healthScore: 82, budget: { used: 40, total: 100 }, agentCount: 3 })]);

    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("$40/$100")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
  });

  it("renders with an empty project list without crashing (only the New Project card)", () => {
    renderProjects([]);

    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.queryByTitle("Delete project")).not.toBeInTheDocument();
  });

  it("clicking a project card sets it active and then navigates to /dashboard", async () => {
    renderProjects([project({ id: "p1", name: "Atlas" })]);

    fireEvent.click(screen.getByText("Atlas"));

    await waitFor(() => expect(setActiveProject).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));

    // setActiveProject must resolve before navigation — assert the mock
    // call ordering wasn't accidentally reversed (Z11 regression guard).
    const activateOrder = setActiveProject.mock.invocationCallOrder[0];
    const navigateOrder = navigateMock.mock.invocationCallOrder[0];
    expect(activateOrder).toBeLessThan(navigateOrder);
  });

  it("clicking 'New Project' navigates to /onboarding without touching project mutations", () => {
    renderProjects([project()]);

    fireEvent.click(screen.getByText("New Project"));

    expect(navigateMock).toHaveBeenCalledWith("/onboarding");
    expect(setActiveProject).not.toHaveBeenCalled();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("clicking the delete icon opens the confirm modal but does not delete yet (C362)", () => {
    renderProjects([project({ id: "p1", name: "Atlas" })]);

    fireEvent.click(screen.getByTitle("Delete project"));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Project")).toBeInTheDocument();
    expect(deleteProject).not.toHaveBeenCalled();
    // Opening the modal must not have also activated/navigated (stopPropagation).
    expect(setActiveProject).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("confirming the delete modal calls deleteProject with the right id and closes it", async () => {
    renderProjects([project({ id: "p1", name: "Atlas" })]);

    fireEvent.click(screen.getByTitle("Delete project"));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancelling the delete modal leaves the project untouched", () => {
    renderProjects([project({ id: "p1", name: "Atlas" })]);

    fireEvent.click(screen.getByTitle("Delete project"));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(deleteProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("highlights the active project's card", () => {
    const active = project({ id: "p1", name: "Atlas" });
    renderProjects([active, project({ id: "p2", name: "Orion" })], active);

    const card = screen.getByText("Atlas").closest(".group");
    expect(card).toHaveClass("border-primary/40");
  });
});
