import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "./sidebar";

// This is the app shell's state machine: SidebarProvider decides whether the
// desktop sidebar is expanded/collapsed, exposes toggleSidebar(), persists
// state via a cookie, supports controlled `open`/`onOpenChange`, and wires a
// global Cmd/Ctrl+B keyboard shortcut. None of that is exercised elsewhere,
// so it's covered directly here rather than through a page that happens to
// render <Sidebar>.

function Probe() {
  const { state, open, toggleSidebar, setOpen } = useSidebar();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="open">{String(open)}</span>
      <button type="button" onClick={toggleSidebar}>
        toggle
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        force-open
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        force-close
      </button>
    </div>
  );
}

function Uncontrolled({ defaultOpen }: { defaultOpen?: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Probe />
    </SidebarProvider>
  );
}

function Controlled({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange}>
      <Probe />
    </SidebarProvider>
  );
}

// A fully-controlled harness where the parent itself owns the open state and
// feeds it back through the `open` prop, the way a real consumer would.
function ControlledRoundTrip() {
  const [open, setOpen] = React.useState(true);
  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      <Probe />
    </SidebarProvider>
  );
}

describe("useSidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "sidebar:state=; path=/; max-age=0";
  });

  it("throws a clear error when used outside a SidebarProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Probe />)).toThrow(/useSidebar must be used within a SidebarProvider/);
  });
});

describe("SidebarProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "sidebar:state=; path=/; max-age=0";
  });

  it("defaults to expanded (open) state", () => {
    render(<Uncontrolled />);

    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
    expect(screen.getByTestId("open")).toHaveTextContent("true");
  });

  it("respects defaultOpen=false for the initial (uncontrolled) state", () => {
    render(<Uncontrolled defaultOpen={false} />);

    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
    expect(screen.getByTestId("open")).toHaveTextContent("false");
  });

  it("toggleSidebar flips open -> collapsed -> expanded in uncontrolled mode", () => {
    render(<Uncontrolled />);

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");

    fireEvent.click(screen.getByText("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
  });

  it("setOpen(true/false) directly sets the state in uncontrolled mode", () => {
    render(<Uncontrolled defaultOpen={false} />);

    fireEvent.click(screen.getByText("force-open"));
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");

    fireEvent.click(screen.getByText("force-close"));
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
  });

  it("persists open state to the sidebar:state cookie on every change", () => {
    render(<Uncontrolled />);

    fireEvent.click(screen.getByText("toggle"));
    expect(document.cookie).toContain("sidebar:state=false");

    fireEvent.click(screen.getByText("toggle"));
    expect(document.cookie).toContain("sidebar:state=true");
  });

  it("Cmd+B toggles the sidebar via the global keyboard shortcut", () => {
    render(<Uncontrolled />);
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
  });

  it("Ctrl+B also toggles the sidebar (non-Mac modifier)", () => {
    render(<Uncontrolled />);

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
  });

  it("plain 'b' without a modifier key does not toggle the sidebar", () => {
    render(<Uncontrolled />);

    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
  });

  it("removes its keydown listener on unmount (no leak / no toggle after unmount)", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Uncontrolled />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("in controlled mode, toggleSidebar calls onOpenChange but does not flip state on its own", () => {
    const onOpenChange = vi.fn();
    render(<Controlled open={true} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText("toggle"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // The provider never owns state when `open` is controlled — since the
    // test harness didn't feed the new value back in, the context's `open`
    // stays pinned to the prop value.
    expect(screen.getByTestId("open")).toHaveTextContent("true");
  });

  it("a fully-controlled round trip (parent state + onOpenChange) does flip visible state", () => {
    render(<ControlledRoundTrip />);

    expect(screen.getByTestId("state")).toHaveTextContent("expanded");

    fireEvent.click(screen.getByText("toggle"));

    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
  });

  it("onOpenChange fires from the keyboard shortcut too, in controlled mode", () => {
    const onOpenChange = vi.fn();
    render(<Controlled open={false} onOpenChange={onOpenChange} />);

    fireEvent.keyDown(window, { key: "b", metaKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
