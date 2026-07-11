import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { AgentStatus } from "@/types/domain";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("maps each AgentStatus to its expected background color class", () => {
    const expected: Record<AgentStatus, string> = {
      working: "bg-success",
      idle: "bg-muted-foreground",
      blocked: "bg-destructive",
      paused: "bg-warning",
      deprecated: "bg-destructive/50",
    };

    for (const [status, colorClass] of Object.entries(expected) as [AgentStatus, string][]) {
      const { container } = render(<StatusDot status={status} />);
      const dot = container.querySelector("span");
      expect(dot).toHaveClass(colorClass);
    }
  });

  it("defaults to the md size (h-2 w-2)", () => {
    const { container } = render(<StatusDot status="idle" />);
    expect(container.querySelector("span")).toHaveClass("h-2", "w-2");
  });

  it("applies the sm/lg size classes when requested", () => {
    const { container: sm } = render(<StatusDot status="idle" size="sm" />);
    expect(sm.querySelector("span")).toHaveClass("h-1.5", "w-1.5");

    const { container: lg } = render(<StatusDot status="idle" size="lg" />);
    expect(lg.querySelector("span")).toHaveClass("h-3", "w-3");
  });

  it("always pulses for a 'working' status even without the pulse prop", () => {
    const { container } = render(<StatusDot status="working" />);
    expect(container.querySelector("span")).toHaveClass("animate-status-pulse");
  });

  it("pulses for a non-working status only when pulse=true is passed explicitly", () => {
    const { container: noPulse } = render(<StatusDot status="idle" />);
    expect(noPulse.querySelector("span")).not.toHaveClass("animate-status-pulse");

    const { container: withPulse } = render(<StatusDot status="idle" pulse />);
    expect(withPulse.querySelector("span")).toHaveClass("animate-status-pulse");
  });

  it("sets the title attribute to the raw status value (tooltip/accessibility affordance)", () => {
    const { container } = render(<StatusDot status="blocked" />);
    expect(container.querySelector("span")).toHaveAttribute("title", "blocked");
  });

  it("merges a caller-supplied className alongside the computed classes", () => {
    const { container } = render(<StatusDot status="idle" className="custom-class" />);
    expect(container.querySelector("span")).toHaveClass("custom-class", "bg-muted-foreground");
  });
});
