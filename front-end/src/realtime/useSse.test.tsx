import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockEventSource } from '@/test/mockEventSource';
import { RealtimeProvider } from './RealtimeProvider';
import { useSse } from './useSse';

let queryClient: QueryClient;

function Runner() {
  useSse();
  return null;
}

/**
 * Mounts `<RealtimeProvider>` on its own first, then mounts `<Runner />`
 * (which calls `useSse()`) in a *separate* commit.
 *
 * This sidesteps a real bug in RealtimeProvider (documented with dedicated
 * regression tests in `RealtimeProvider.test.tsx`, "KNOWN BUG" section):
 * React fires a descendant's mount effects before its ancestor's, so a
 * consumer that subscribes in the *same* commit as `<RealtimeProvider>`
 * mounting never actually gets its listener attached to the live
 * `EventSource`. `App.tsx` currently renders `<RealtimeBridge />` (which
 * calls `useSse()`) as a direct, non-lazy child of `<RealtimeProvider>`, so
 * this bug is believed to affect the real app on every page load — see the
 * report for this test suite. These tests mount in two phases so they
 * exercise `useSse()`'s event -> invalidation mapping logic in isolation
 * from that unrelated mounting bug.
 */
function renderSse(mount = true) {
  function Harness({ mounted }: { mounted: boolean }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>{mounted ? <Runner /> : null}</RealtimeProvider>
      </QueryClientProvider>
    );
  }
  const utils = render(<Harness mounted={false} />);
  const [source] = MockEventSource.instances;
  if (!source) throw new Error('expected RealtimeProvider to open an EventSource on mount');
  act(() => utils.rerender(<Harness mounted={mount} />));
  return { source, rerender: (mounted: boolean) => act(() => utils.rerender(<Harness mounted={mounted} />)) };
}

beforeEach(() => {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useSse() — event -> query invalidation bridge', () => {
  it('invalidates the mapped query keys for a simple event ("project.updated")', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('project.updated', {}));

    expect(spy).toHaveBeenCalledTimes(3);
    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toEqual(
      expect.arrayContaining([['projects'], ['projects', 'active'], ['settings']]),
    );
  });

  it('drills invalidation down to the payload-scoped keys for "agent.status"', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('agent.status', { projectId: 'proj-1', agentId: 'agent-9' }));

    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['agents', 'proj-1'],
        ['agent-messages', 'agent-9'],
        ['agent-lineage', 'agent-9'],
      ]),
    );
  });

  it('falls back to the unscoped keys for "agent.status" when the payload is missing ids', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('agent.status', {}));

    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toEqual(expect.arrayContaining([['agents'], ['agent-messages'], ['agent-lineage']]));
  });

  it('treats malformed (non-JSON) event data as a null payload rather than throwing', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    expect(() => act(() => source.emit('agent.status', 'not-json{'))).not.toThrow();
    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toEqual(expect.arrayContaining([['agents'], ['agent-messages'], ['agent-lineage']]));
  });

  it('blanket-invalidates every query on "sync.required" (broadcast buffer lag)', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('sync.required', { skipped: 42 }));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBeUndefined();
  });

  it('ignores event names with no registered handler', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    // No native listener exists for an unmapped name, so emit() is a no-op,
    // but this also guards against HANDLERS silently swallowing unknowns.
    expect(source.listenerCount('totally.unknown.event')).toBe(0);
    act(() => source.emit('totally.unknown.event', {}));
    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribes all handlers on unmount so later events do not trigger invalidation', () => {
    const { source, rerender } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('project.updated', {}));
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockClear();

    rerender(false); // unmounts <Runner />, should tear down useSse's subscriptions
    expect(source.listenerCount('project.updated')).toBe(0);

    act(() => source.emit('project.updated', {}));
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps "cost.ingested" with a projectId to the project-scoped insight keys', () => {
    const { source } = renderSse();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('cost.ingested', { projectId: 'proj-7' }));

    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ['projects'],
        ['spend-timeline'],
        ['insights', 'cost-timeline', 'proj-7'],
        ['insights', 'agent-token-usage', 'proj-7'],
      ]),
    );
  });
});

describe('useSse() — real initial-mount shape (regression for the SSE-race fix)', () => {
  // App.tsx mounts `<RealtimeBridge />` (which calls `useSse()`) as a
  // direct child of `<RealtimeProvider>`, in the same commit, with no
  // Suspense boundary between them. The provider's mount effect now rebinds
  // pre-created listeners to the freshly created source, so `useSse()`'s
  // subscriptions attach even though the consumer's effect ran before the
  // provider's. This test reproduces that exact shape (unlike the rest of
  // this file, which mounts in two phases to test the mapping in isolation)
  // and asserts invalidation fires.
  it('invalidates when RealtimeProvider and the useSse() consumer mount in the same commit', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>
          <Runner />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    const [source] = MockEventSource.instances;
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('project.updated', {}));

    // `project.updated` maps to a 3-key invalidation in the HANDLERS map.
    expect(spy).toHaveBeenCalled();
  });
});
