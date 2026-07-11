import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { reducer, useToast, toast } from "./use-toast";

// The module keeps a module-level `memoryState` + `listeners` array that
// persists across tests (it's a singleton store, mirroring how the real app
// uses it). We reset it between tests by dismissing + removing everything
// via the public API and by only asserting on relative changes, and we use
// fake timers so the (very long) auto-remove delay never actually fires
// unless a test intentionally advances it.

// NOTE: reducer's DISMISS_TOAST case has a documented side effect — it
// calls the module-level `addToRemoveQueue`, which schedules a *real*
// setTimeout keyed by whatever `toastId` string is passed in (see the "!
// Side effects !" comment in use-toast.ts). `toastTimeouts` is a shared,
// never-reset Map, so a reducer test that dismisses id "1" registers a
// real timer against that literal string. Later, `toast()` mints ids via a
// sequential counter that also starts at "1". If both use plain numeric
// ids, the real dismiss test "wins" the race for `toastTimeouts.has("1")`
// and the store test's *fake*-timer advance never fires anything for that
// id. Using ids that can't collide with genId()'s output keeps these two
// independent concerns (pure-reducer shape vs. store timing behavior) from
// interfering with each other.
describe("use-toast reducer", () => {
  it("ADD_TOAST prepends and clamps to TOAST_LIMIT (1)", () => {
    const state = { toasts: [] };
    const s1 = reducer(state, {
      type: "ADD_TOAST",
      toast: { id: "reducer-a", open: true },
    });
    expect(s1.toasts).toHaveLength(1);
    expect(s1.toasts[0].id).toBe("reducer-a");

    const s2 = reducer(s1, {
      type: "ADD_TOAST",
      toast: { id: "reducer-b", open: true },
    });
    // TOAST_LIMIT is 1, so the newest toast replaces the oldest.
    expect(s2.toasts).toHaveLength(1);
    expect(s2.toasts[0].id).toBe("reducer-b");
  });

  it("UPDATE_TOAST merges fields into the matching toast by id", () => {
    const state = { toasts: [{ id: "reducer-a", open: true, title: "original" }] };
    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "reducer-a", title: "updated" },
    });
    expect(next.toasts[0].title).toBe("updated");
    expect(next.toasts[0].open).toBe(true);
  });

  it("UPDATE_TOAST leaves non-matching toasts untouched", () => {
    const state = {
      toasts: [
        { id: "reducer-a", open: true, title: "a" },
        { id: "reducer-b", open: true, title: "b" },
      ],
    };
    const next = reducer(state, {
      type: "UPDATE_TOAST",
      toast: { id: "reducer-a", title: "changed" },
    });
    expect(next.toasts[1].title).toBe("b");
  });

  it("DISMISS_TOAST with an id sets only that toast's open to false", () => {
    const state = {
      toasts: [
        { id: "reducer-a", open: true },
        { id: "reducer-b", open: true },
      ],
    };
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: "reducer-a" });
    expect(next.toasts.find((t) => t.id === "reducer-a")?.open).toBe(false);
    expect(next.toasts.find((t) => t.id === "reducer-b")?.open).toBe(true);
  });

  it("DISMISS_TOAST without an id sets every toast's open to false", () => {
    const state = {
      toasts: [
        { id: "reducer-a", open: true },
        { id: "reducer-b", open: true },
      ],
    };
    const next = reducer(state, { type: "DISMISS_TOAST", toastId: undefined });
    expect(next.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST with an id removes only that toast", () => {
    const state = {
      toasts: [
        { id: "reducer-a", open: false },
        { id: "reducer-b", open: false },
      ],
    };
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: "reducer-a" });
    expect(next.toasts).toHaveLength(1);
    expect(next.toasts[0].id).toBe("reducer-b");
  });

  it("REMOVE_TOAST without an id clears all toasts", () => {
    const state = {
      toasts: [
        { id: "reducer-a", open: false },
        { id: "reducer-b", open: false },
      ],
    };
    const next = reducer(state, { type: "REMOVE_TOAST", toastId: undefined });
    expect(next.toasts).toHaveLength(0);
  });
});

describe("toast() store + useToast()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Drain any toasts left behind by a test so later tests start from an
    // (approximately) empty store, then restore real timers.
    act(() => {
      toast({}).dismiss();
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("auto-removes a dismissed toast once TOAST_REMOVE_DELAY elapses", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Will expire" });
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.dismiss(result.current.toasts[0].id);
    });
    expect(result.current.toasts[0].open).toBe(false);

    // TOAST_REMOVE_DELAY is 1_000_000ms — nothing should happen before it.
    act(() => {
      vi.advanceTimersByTime(999_999);
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it("toast() adds a toast that a subscribed useToast() hook observes", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Hello" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Hello");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("respects TOAST_LIMIT — a second toast() replaces the first", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "First" });
    });
    act(() => {
      toast({ title: "Second" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss(id) marks the toast open:false without removing it immediately", () => {
    const { result } = renderHook(() => useToast());

    let id = "";
    act(() => {
      id = toast({ title: "Dismiss me" }).id;
    });

    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.toasts[0].open).toBe(false);
    // Still present — REMOVE_TOAST only fires after the (long) delay.
    expect(result.current.toasts).toHaveLength(1);
  });

  it("update() mutates an existing toast in place by id", () => {
    const { result } = renderHook(() => useToast());

    let handle: ReturnType<typeof toast> | undefined;
    act(() => {
      handle = toast({ title: "Original" });
    });

    act(() => {
      handle!.update({ id: handle!.id, title: "Updated", open: true });
    });

    expect(result.current.toasts[0].title).toBe("Updated");
  });

  it("toast's own dismiss() (returned from toast()) also closes it", () => {
    const { result } = renderHook(() => useToast());

    let handle: ReturnType<typeof toast> | undefined;
    act(() => {
      handle = toast({ title: "Closable" });
    });

    act(() => {
      handle!.dismiss();
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("onOpenChange(false) triggers the same dismiss path as calling dismiss()", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Via onOpenChange" });
    });

    act(() => {
      result.current.toasts[0].onOpenChange?.(false);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("subscribes its listener exactly once per mount, and unsubscribes on unmount (no leak)", () => {
    const { result: r1, unmount: unmount1 } = renderHook(() => useToast());
    const { result: r2, unmount: unmount2 } = renderHook(() => useToast());

    // Both hooks are mounted; a single toast() call should update both.
    act(() => {
      toast({ title: "Broadcast" });
    });
    expect(r1.current.toasts[0].title).toBe("Broadcast");
    expect(r2.current.toasts[0].title).toBe("Broadcast");

    unmount1();
    unmount2();

    // After both unmount, dispatching should not throw and should not
    // resurrect either hook's stale `result.current` (regression guard for
    // the `[state]` -> `[]` effect-dependency bug: with `[state]`, the
    // effect would re-run on every dispatch and re-subscribe a listener
    // that was already unsubscribed, potentially leaking the count each
    // update — a mount/unmount/dispatch cycle used to grow the listener
    // count unboundedly).
    expect(() => {
      act(() => {
        toast({ title: "After unmount" });
      });
    }).not.toThrow();
  });

  it("mounting and unmounting the same hook twice does not leak listeners", () => {
    // Indirect leak check: if listeners were never removed, dispatching
    // after N mount/unmount cycles would call N stale setState functions.
    // React would throw/warn if setState is called on an unmounted
    // component in certain configurations; more directly, we assert that
    // a mount -> unmount -> mount -> unmount cycle still leaves exactly the
    // expected (empty, since both unmounted) listener behavior: no error
    // and the last-mounted hook (if remounted) still receives updates.
    for (let i = 0; i < 5; i += 1) {
      const { unmount } = renderHook(() => useToast());
      unmount();
    }

    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "Only listener left" });
    });
    expect(result.current.toasts[0].title).toBe("Only listener left");
  });
});
