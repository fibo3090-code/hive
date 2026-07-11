import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LlmModel, LlmProvider } from "@/api/llm";

// A sibling agent owns the data-fetching layer (react-query hooks in
// @/api/llm); here we only need controllable stand-ins so ModelPicker's own
// cascading provider->model selection logic (auto-select, empty/error
// states, onChange wiring) can be exercised without a real network layer or
// QueryClientProvider.
vi.mock("@/api/llm", () => ({
  useLlmProviders: vi.fn(),
  useProviderModels: vi.fn(),
}));

import { useLlmProviders, useProviderModels } from "@/api/llm";
import { ModelPicker } from "./ModelPicker";

function provider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    connected: true,
    baseUrl: null,
    maskedKey: "sk-***",
    hasKey: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function model(overrides: Partial<LlmModel> = {}): LlmModel {
  return {
    id: "claude-opus",
    label: "Claude Opus",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    ...overrides,
  };
}

function mockProviders(data: LlmProvider[] | undefined, extra: Record<string, unknown> = {}) {
  vi.mocked(useLlmProviders).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    ...extra,
  } as unknown as ReturnType<typeof useLlmProviders>);
}

function mockModels(data: LlmModel[] | undefined, extra: Record<string, unknown> = {}) {
  const refetch = vi.fn();
  vi.mocked(useProviderModels).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
    ...extra,
  } as unknown as ReturnType<typeof useProviderModels>);
  return refetch;
}

describe("ModelPicker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading indicator while providers are being fetched", () => {
    mockProviders(undefined, { isLoading: true });
    mockModels(undefined);

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    expect(screen.getByText("Loading providers…")).toBeInTheDocument();
  });

  it("shows an empty state when there are no connected providers", () => {
    mockProviders([provider({ connected: false })]);
    mockModels(undefined);

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    expect(screen.getByText(/No connected providers/)).toBeInTheDocument();
  });

  it("auto-selects the first connected provider and fetches its models", () => {
    mockProviders([
      provider({ id: "p1", name: "Provider One", connected: true }),
      provider({ id: "p2", name: "Provider Two", connected: true }),
    ]);
    mockModels([model({ id: "m1", label: "Model One" })]);

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    // The first connected provider's button renders as "active".
    const p1Button = screen.getByText("Provider One").closest("button");
    expect(p1Button).toHaveClass("border-primary");

    // useProviderModels was (eventually) called with the auto-selected id.
    expect(vi.mocked(useProviderModels).mock.calls.some((call) => call[0] === "p1")).toBe(true);
  });

  it("skips disconnected providers when choosing which to show", () => {
    mockProviders([
      provider({ id: "p1", name: "Disconnected One", connected: false }),
      provider({ id: "p2", name: "Connected One", connected: true }),
    ]);
    mockModels([]);

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    expect(screen.queryByText("Disconnected One")).not.toBeInTheDocument();
    expect(screen.getByText("Connected One")).toBeInTheDocument();
  });

  it("shows an error message (Error instance) and a Retry button when the models query fails", () => {
    mockProviders([provider({ id: "p1" })]);
    const refetch = mockModels(undefined, { isError: true, error: new Error("boom") });

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    // "Failed to list models:", the error message, and the Retry button's
    // icon+label all share one parent <div>, so the message text and the
    // literal error text are sibling text nodes joined into that div's node
    // text rather than separate elements — match on the combined text.
    expect(screen.getByText(/Failed to list models:\s*boom/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("stringifies a non-Error error value instead of crashing (instanceof Error guard)", () => {
    mockProviders([provider({ id: "p1" })]);
    mockModels(undefined, { isError: true, error: "network unreachable" });

    render(<ModelPicker value={null} onChange={vi.fn()} />);

    expect(screen.getByText(/Failed to list models:\s*network unreachable/)).toBeInTheDocument();
  });

  it("auto-selects the first model once models load and there is no valid current selection", () => {
    mockProviders([provider({ id: "p1" })]);
    mockModels([model({ id: "m1" }), model({ id: "m2" })]);
    const onChange = vi.fn();

    render(<ModelPicker value={null} onChange={onChange} />);

    expect(onChange).toHaveBeenCalledWith({ providerId: "p1", modelId: "m1" });
  });

  it("clicking a model button calls onChange with that provider/model pair", () => {
    mockProviders([provider({ id: "p1" })]);
    mockModels([model({ id: "m1", label: "Model One" }), model({ id: "m2", label: "Model Two" })]);
    const onChange = vi.fn();

    render(<ModelPicker value={{ providerId: "p1", modelId: "m1" }} onChange={onChange} />);
    onChange.mockClear();

    fireEvent.click(screen.getByText("Model Two"));

    expect(onChange).toHaveBeenCalledWith({ providerId: "p1", modelId: "m2" });
  });

  it("does not auto-fire onChange when the current value already matches a real model", () => {
    mockProviders([provider({ id: "p1" })]);
    mockModels([model({ id: "m1" }), model({ id: "m2" })]);
    const onChange = vi.fn();

    render(<ModelPicker value={{ providerId: "p1", modelId: "m2" }} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking a different provider switches the active provider selection", () => {
    mockProviders([
      provider({ id: "p1", name: "Provider One" }),
      provider({ id: "p2", name: "Provider Two" }),
    ]);
    mockModels([model({ id: "m1" })]);

    render(<ModelPicker value={{ providerId: "p1", modelId: "m1" }} onChange={vi.fn()} />);

    fireEvent.click(screen.getByText("Provider Two"));

    const p2Button = screen.getByText("Provider Two").closest("button");
    expect(p2Button).toHaveClass("border-primary");
  });

  it("disables provider and model buttons when the disabled prop is set", () => {
    mockProviders([provider({ id: "p1", name: "Provider One" })]);
    mockModels([model({ id: "m1", label: "Model One" })]);

    render(<ModelPicker value={null} onChange={vi.fn()} disabled />);

    expect(screen.getByText("Provider One").closest("button")).toBeDisabled();
    expect(screen.getByText("Model One").closest("button")).toBeDisabled();
  });
});
