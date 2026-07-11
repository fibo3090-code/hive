import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SovereigntyBadge } from "./SovereigntyBadge";

describe("SovereigntyBadge", () => {
  it("renders the Local label/style for tier='local'", () => {
    const { container } = render(<SovereigntyBadge tier="local" />);

    expect(screen.getByText("Local")).toBeInTheDocument();
    expect(container.querySelector("span")).toHaveClass("text-success");
  });

  it("renders the Cloud label/style for tier='cloud'", () => {
    const { container } = render(<SovereigntyBadge tier="cloud" />);

    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(container.querySelector("span")).toHaveClass("text-info");
  });

  it("falls back to Local for the legacy 'hybrid' tier instead of crashing", () => {
    render(<SovereigntyBadge tier="hybrid" />);

    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("falls back to Local for any unrecognized tier string without crashing", () => {
    render(<SovereigntyBadge tier="totally-unknown-tier" />);

    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("merges a caller-supplied className", () => {
    const { container } = render(<SovereigntyBadge tier="local" className="extra" />);

    expect(container.querySelector("span")).toHaveClass("extra");
  });
});
