import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DisabledFeature } from "./DisabledFeature";

describe("DisabledFeature", () => {
  it("renders its children, visually dimmed and non-interactive", () => {
    render(
      <DisabledFeature>
        <button type="button">Do the thing</button>
      </DisabledFeature>,
    );

    const button = screen.getByText("Do the thing");
    expect(button).toBeInTheDocument();
    // The dimming/pointer-events-none wrapper is the direct parent span.
    expect(button.parentElement).toHaveClass("pointer-events-none", "opacity-40");
  });

  it("defaults to kind='planned' with a 'Planned' badge", () => {
    render(
      <DisabledFeature>
        <span>Feature</span>
      </DisabledFeature>,
    );

    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("shows a 'Server-only' badge for kind='server-only'", () => {
    render(
      <DisabledFeature kind="server-only">
        <span>Feature</span>
      </DisabledFeature>,
    );

    expect(screen.getByText("Server-only")).toBeInTheDocument();
    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
  });

  it("hides the badge entirely when showBadge=false", () => {
    render(
      <DisabledFeature showBadge={false}>
        <span>Feature</span>
      </DisabledFeature>,
    );

    expect(screen.queryByText("Planned")).not.toBeInTheDocument();
    expect(screen.queryByText("Server-only")).not.toBeInTheDocument();
  });

  it("merges a caller-supplied className onto the wrapper", () => {
    render(
      <DisabledFeature className="my-extra-class">
        <span>Feature</span>
      </DisabledFeature>,
    );

    expect(screen.getByText("Feature").closest("span.cursor-not-allowed")).toHaveClass("my-extra-class");
  });
});
