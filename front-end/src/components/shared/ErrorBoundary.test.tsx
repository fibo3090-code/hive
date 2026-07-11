import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// Toggled by Bomb below so a single component can go from "throws" to
// "renders fine" between renders, letting us exercise the reset path.
let shouldThrow = true;

function Bomb() {
  if (shouldThrow) {
    throw new Error("Kaboom");
  }
  return <div>Recovered content</div>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    shouldThrow = true;
    vi.restoreAllMocks();
  });

  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("catches a thrown error and renders the fallback UI with the scope and message", () => {
    // React logs the error to console.error (via componentDidCatch calling
    // logger.error, which always logs) — expected noise, silence it.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary scope="Widget">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Widget crashed")).toBeInTheDocument();
    expect(screen.getByText("Kaboom")).toBeInTheDocument();
  });

  it("falls back to a generic heading when no scope is given", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders a custom fallback node instead of the default UI when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("'Try again' resets hasError and re-renders children (recovery path)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary scope="Widget">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Widget crashed")).toBeInTheDocument();

    // Fix the underlying condition, then trigger the boundary's reset.
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try again"));

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
    expect(screen.queryByText("Widget crashed")).not.toBeInTheDocument();
  });

  it("clicking 'Try again' while the child still throws re-shows the fallback (no crash)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary scope="Widget">
        <Bomb />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText("Try again"));

    expect(screen.getByText("Widget crashed")).toBeInTheDocument();
  });

  it("logs the error via the shared logger with the boundary's scope", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary scope="Widget">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(errorSpy).toHaveBeenCalled();
    const loggedCallText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedCallText).toContain("error-boundary");
    expect(loggedCallText).toContain("Widget");
  });
});
