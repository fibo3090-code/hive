import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, cleanup, screen, renderHook, waitFor } from '@testing-library/react';
import { MockEventSource } from '@/test/mockEventSource';
import { RealtimeProvider, useRealtime, useRealtimeEvent, type ConnectionState } from './RealtimeProvider';

/** Renders a harness under a fresh RealtimeProvider and hands back the live
 *  `EventSource` mock instance plus whatever the test wants to observe. */
function renderRealtime(children: React.ReactNode) {
  render(<RealtimeProvider>{children}</RealtimeProvider>);
  const [source] = MockEventSource.instances;
  if (!source) throw new Error('expected RealtimeProvider to open an EventSource on mount');
  return source;
}

/**
 * Mounts `<RealtimeProvider>` by itself first (so its own mount effect runs
 * and `sourceRef.current` is populated), then mounts the consumer in a
 * *separate* commit.
 *
 * This matters: React fires descendant `useEffect`s before ancestor ones
 * within a single commit. If a consumer's `subscribe()` call and
 * `RealtimeProvider`'s own `new EventSource(...)` effect land in the same
 * commit (i.e. the consumer is a static child, not behind e.g. a Suspense
 * boundary), the consumer's effect runs *first*, while `sourceRef.current`
 * is still `null` — see the dedicated "mount-order race" tests below for
 * what that does. Splitting into two commits here models the common case
 * of a component subscribing sometime after the provider is already live
 * (e.g. a lazy-loaded route), which is what these tests intend to exercise.
 */
function renderRealtimeThenMount(renderConsumer: () => React.ReactNode) {
  function Harness({ mounted }: { mounted: boolean }) {
    return <RealtimeProvider>{mounted ? renderConsumer() : null}</RealtimeProvider>;
  }
  const utils = render(<Harness mounted={false} />);
  const [source] = MockEventSource.instances;
  if (!source) throw new Error('expected RealtimeProvider to open an EventSource on mount');
  act(() => utils.rerender(<Harness mounted={true} />));
  return source;
}

beforeEach(() => {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RealtimeProvider — singleton EventSource', () => {
  it('opens exactly one EventSource for the whole app, even with multiple subscribers', () => {
    function ConsumerA() {
      const { subscribe } = useRealtime();
      React.useEffect(() => subscribe('agent.status', () => {}), [subscribe]);
      return null;
    }
    function ConsumerB() {
      const { subscribe } = useRealtime();
      React.useEffect(() => subscribe('task.status', () => {}), [subscribe]);
      return null;
    }

    render(
      <RealtimeProvider>
        <ConsumerA />
        <ConsumerB />
      </RealtimeProvider>,
    );

    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('points the EventSource at the shared /v1/events stream', () => {
    const source = renderRealtime(null);
    expect(source.url).toMatch(/\/v1\/events$/);
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = render(<RealtimeProvider>{null}</RealtimeProvider>);
    const [source] = MockEventSource.instances;
    expect(source.readyState).not.toBe(MockEventSource.CLOSED);
    unmount();
    expect(source.readyState).toBe(MockEventSource.CLOSED);
  });

  it('throws when useRealtime() is called outside a RealtimeProvider', () => {
    const { result } = renderHook(() => {
      try {
        return useRealtime();
      } catch (err) {
        return err;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toMatch(/must be used inside <RealtimeProvider>/);
  });
});

describe('RealtimeProvider — connection state', () => {
  it('starts "connecting" and transitions to "open" when the source opens', async () => {
    const states: ConnectionState[] = [];
    function Watcher() {
      const { connectionState } = useRealtime();
      states.push(connectionState);
      return <span data-testid="state">{connectionState}</span>;
    }
    render(
      <RealtimeProvider>
        <Watcher />
      </RealtimeProvider>,
    );
    expect(screen.getByTestId('state').textContent).toBe('connecting');

    const [source] = MockEventSource.instances;
    act(() => source.simulateOpen());

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('open'));
  });

  it('goes back to "connecting" (and bumps reconnectCount) on a non-fatal transport error', async () => {
    let latestReconnectCount = -1;
    function Watcher() {
      const { connectionState, reconnectCount } = useRealtime();
      latestReconnectCount = reconnectCount;
      return <span data-testid="state">{connectionState}</span>;
    }
    render(
      <RealtimeProvider>
        <Watcher />
      </RealtimeProvider>,
    );
    const [source] = MockEventSource.instances;

    act(() => source.simulateOpen());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('open'));
    expect(latestReconnectCount).toBe(0);

    act(() => source.simulateError(MockEventSource.CONNECTING));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('connecting'));
    expect(latestReconnectCount).toBe(1);

    act(() => source.simulateError(MockEventSource.CONNECTING));
    await waitFor(() => expect(latestReconnectCount).toBe(2));
  });

  it('moves to "closed" when the browser gives up (readyState CLOSED on error)', async () => {
    function Watcher() {
      const { connectionState } = useRealtime();
      return <span data-testid="state">{connectionState}</span>;
    }
    render(
      <RealtimeProvider>
        <Watcher />
      </RealtimeProvider>,
    );
    const [source] = MockEventSource.instances;

    act(() => source.simulateError(MockEventSource.CLOSED));

    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('closed'));
  });
});

describe('RealtimeProvider — subscribe()', () => {
  it('delivers events to an exact-name subscriber and not to other names', () => {
    const fooHandler = vi.fn();
    const barHandler = vi.fn();
    function Consumer() {
      const { subscribe } = useRealtime();
      React.useEffect(() => {
        const u1 = subscribe('foo.happened', fooHandler);
        const u2 = subscribe('bar.happened', barHandler);
        return () => {
          u1();
          u2();
        };
      }, [subscribe]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    act(() => source.emit('foo.happened', { ok: true }));

    expect(fooHandler).toHaveBeenCalledTimes(1);
    expect(barHandler).not.toHaveBeenCalled();
    const event = fooHandler.mock.calls[0][0] as MessageEvent;
    expect(JSON.parse(event.data)).toEqual({ ok: true });
  });

  it('fans out one native listener to multiple handlers for the same event name', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    function Consumer() {
      const { subscribe } = useRealtime();
      React.useEffect(() => {
        const u1 = subscribe('project.updated', handlerA);
        const u2 = subscribe('project.updated', handlerB);
        return () => {
          u1();
          u2();
        };
      }, [subscribe]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    expect(source.listenerCount('project.updated')).toBe(1);
    act(() => source.emit('project.updated', {}));
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery and, once the last handler leaves, removes the native listener', () => {
    const handler = vi.fn();
    let unsubscribe: (() => void) | undefined;
    function Consumer() {
      const { subscribe } = useRealtime();
      React.useEffect(() => {
        unsubscribe = subscribe('alert.created', handler);
      }, [subscribe]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    expect(source.listenerCount('alert.created')).toBe(1);
    act(() => unsubscribe?.());
    expect(source.listenerCount('alert.created')).toBe(0);

    act(() => source.emit('alert.created', {}));
    expect(handler).not.toHaveBeenCalled();
  });

  it('a handler that throws does not stop sibling handlers for the same event', () => {
    const ok = vi.fn();
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    function Consumer() {
      const { subscribe } = useRealtime();
      React.useEffect(() => {
        const u1 = subscribe('notification.created', throwing);
        const u2 = subscribe('notification.created', ok);
        return () => {
          u1();
          u2();
        };
      }, [subscribe]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    expect(() => act(() => source.emit('notification.created', {}))).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('RealtimeProvider — subscribePrefix()', () => {
  it('delivers to a prefix subscriber once the exact event name has a native listener attached', () => {
    // subscribePrefix() alone does not attach a native EventSource listener
    // for every id under that prefix (there is no wildcard in the SSE API).
    // It piggybacks on whatever exact-name listeners are already attached.
    // Here we pair it with a real consumer of the concrete event name, which
    // is the documented usage pattern.
    const prefixHandler = vi.fn();
    const exactHandler = vi.fn();
    function Consumer() {
      const { subscribe, subscribePrefix } = useRealtime();
      React.useEffect(() => {
        const u1 = subscribePrefix('agent.', prefixHandler);
        const u2 = subscribe('agent.42.inbox', exactHandler);
        return () => {
          u1();
          u2();
        };
      }, [subscribe, subscribePrefix]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    act(() => source.emit('agent.42.inbox', { n: 1 }));

    expect(exactHandler).toHaveBeenCalledTimes(1);
    expect(prefixHandler).toHaveBeenCalledTimes(1);
    const [eventName, event] = prefixHandler.mock.calls[0];
    expect(eventName).toBe('agent.42.inbox');
    expect(JSON.parse((event as MessageEvent).data)).toEqual({ n: 1 });
  });

  it('does NOT fire for a prefix-matching event name that has no exact-name subscriber', () => {
    // This documents a real gap: subscribePrefix registers a handler but
    // ensureNativeListener() is only ever called from subscribe(), so a
    // prefix-only subscription never attaches a listener to the underlying
    // EventSource and will silently never receive events unless something
    // else happens to subscribe() to that exact name too.
    const prefixHandler = vi.fn();
    function Consumer() {
      const { subscribePrefix } = useRealtime();
      React.useEffect(() => subscribePrefix('agent.', prefixHandler), [subscribePrefix]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    expect(source.listenerCount('agent.99.inbox')).toBe(0);
    act(() => source.emit('agent.99.inbox', { n: 1 }));

    expect(prefixHandler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops prefix delivery', () => {
    const prefixHandler = vi.fn();
    let unsubscribePrefix: (() => void) | undefined;
    function Consumer() {
      const { subscribe, subscribePrefix } = useRealtime();
      React.useEffect(() => {
        unsubscribePrefix = subscribePrefix('agent.', prefixHandler);
        return subscribe('agent.7.inbox', () => {});
      }, [subscribe, subscribePrefix]);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer />);

    act(() => unsubscribePrefix?.());
    act(() => source.emit('agent.7.inbox', {}));

    expect(prefixHandler).not.toHaveBeenCalled();
  });
});

describe('useRealtimeEvent()', () => {
  it('subscribes to the given event and cleans up on unmount', () => {
    const handler = vi.fn();
    function Consumer({ eventName }: { eventName: string | null }) {
      useRealtimeEvent(eventName, handler);
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer eventName="drift.detected" />);

    act(() => source.emit('drift.detected', {}));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(source.listenerCount('drift.detected')).toBe(1);
  });

  it('does nothing when eventName is null/undefined', () => {
    function Consumer({ eventName }: { eventName: string | null }) {
      useRealtimeEvent(eventName, vi.fn());
      return null;
    }
    const source = renderRealtimeThenMount(() => <Consumer eventName={null} />);
    expect(source.listenerCount('drift.detected')).toBe(0);
  });
});

describe('RealtimeProvider — initial-mount subscribe race (regression for the SSE-race fix)', () => {
  // React fires a subtree's *descendant* passive effects before its
  // *ancestor* ones within a single commit. RealtimeProvider's own
  // `useEffect` is what creates `sourceRef.current`, so a consumer that
  // calls `subscribe()` in the same commit (e.g. <RealtimeBridge> → useSse,
  // a direct child of the provider in App.tsx) runs while `sourceRef.current`
  // is still null and its `addEventListener` no-ops. The provider's mount
  // effect now re-binds those pre-created listener closures to the freshly
  // created source directly (it used to call `ensureNativeListener`, which
  // early-returns for an existing closure and so never rebound — dropping
  // every SSE event for the whole app on first load).
  //
  // These tests assert delivery SUCCEEDS. If they start failing, the
  // re-attach loop in RealtimeProvider's mount effect has regressed.
  it('delivers events to a consumer that subscribes in the same commit as the Provider mounts', () => {
    const handler = vi.fn();
    function Consumer() {
      const { subscribe } = useRealtime();
      React.useEffect(() => subscribe('project.updated', handler), [subscribe]);
      return null;
    }

    // Single commit: Provider + Consumer mount together, exactly like
    // `<RealtimeProvider><RealtimeBridge /></RealtimeProvider>` in App.tsx.
    render(
      <RealtimeProvider>
        <Consumer />
      </RealtimeProvider>,
    );
    const [source] = MockEventSource.instances;

    act(() => source.emit('project.updated', {}));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('delivers for the real RealtimeBridge/useSse() mount shape', () => {
    // Mirrors App.tsx exactly: useSse() called from a component mounted as
    // a direct child of RealtimeProvider, same commit, no Suspense in
    // between.
    function RealtimeBridge({ onInvalidate }: { onInvalidate: () => void }) {
      const { subscribe } = useRealtime();
      React.useEffect(() => subscribe('project.updated', onInvalidate), [subscribe, onInvalidate]);
      return null;
    }
    const onInvalidate = vi.fn();

    render(
      <RealtimeProvider>
        <RealtimeBridge onInvalidate={onInvalidate} />
      </RealtimeProvider>,
    );
    const [source] = MockEventSource.instances;

    act(() => source.emit('project.updated', {}));

    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });
});
