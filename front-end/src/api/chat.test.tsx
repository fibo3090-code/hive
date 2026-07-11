import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect, useState } from 'react';
import { renderHook, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockEventSource } from '@/test/mockEventSource';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { useChatStream } from './chat';

let queryClient: QueryClient;

/**
 * Renders `<RealtimeProvider>` immediately, but defers mounting `children`
 * (the hook-under-test) to a second commit via local state.
 *
 * Why: React fires a descendant's mount effects before its ancestor's
 * within one commit. If `useChatStream`'s subscribe() calls happened in the
 * *same* commit as `<RealtimeProvider>` mounting, they'd race
 * `RealtimeProvider`'s own effect (which creates the `EventSource`) and
 * lose — the listener would never actually attach. That's a real,
 * previously-undiscovered bug in `RealtimeProvider` (see the "KNOWN BUG"
 * tests in `RealtimeProvider.test.tsx` and `useSse.test.tsx` for the full
 * writeup) that also affects the real app, since `App.tsx` mounts the
 * global `useSse()` consumer as a direct child of `RealtimeProvider`. These
 * tests defer mounting by one tick specifically to exercise
 * `useChatStream`'s own accumulation/finalize logic independent of that
 * unrelated mounting bug.
 */
function Wrapper({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>{ready ? children : null}</RealtimeProvider>
    </QueryClientProvider>
  );
}

function getSource() {
  const [source] = MockEventSource.instances;
  if (!source) throw new Error('expected RealtimeProvider to open an EventSource');
  return source;
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

describe('useChatStream()', () => {
  it('accumulates chat.<id>.token deltas into a single growing text segment', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => {
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'Hel' });
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'lo' });
    });

    const msg = result.current['m1'];
    expect(msg?.content).toBe('Hello');
    expect(msg?.segments).toEqual([{ kind: 'text', content: 'Hello' }]);
    expect(msg?.status).toBe('streaming');
  });

  it('ignores token events for a different threadId', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => source.emit('chat.t1.token', { threadId: 'other-thread', messageId: 'm1', delta: 'nope' }));

    expect(result.current['m1']).toBeUndefined();
  });

  it('finalizes on chat.<id>.complete: sets status complete, records usage, and invalidates chat-messages', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'Done.' });
      source.emit('chat.t1.complete', {
        threadId: 't1',
        messageId: 'm1',
        tokensIn: 12,
        tokensOut: 34,
        costCents: 5,
        durationMs: 987,
      });
    });

    const msg = result.current['m1'];
    expect(msg?.status).toBe('complete');
    expect(msg?.content).toBe('Done.');
    expect(msg).toMatchObject({ tokensIn: 12, tokensOut: 34, costCents: 5, durationMs: 987 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-messages', 't1'] });
  });

  it('marks the message cancelled on chat.<id>.cancelled and invalidates chat-messages', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('chat.t1.cancelled', { threadId: 't1', messageId: 'm1' }));

    expect(result.current['m1']?.status).toBe('cancelled');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-messages', 't1'] });
  });

  it('marks the message errored on chat.<id>.error and invalidates chat-messages', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => source.emit('chat.t1.error', { threadId: 't1', messageId: 'm1' }));

    expect(result.current['m1']?.status).toBe('error');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['chat-messages', 't1'] });
  });

  it('interleaves tool_call / tool_result segments with text in arrival order (causal honesty)', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => {
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'Let me check. ' });
      source.emit('chat.t1.tool_call', {
        threadId: 't1',
        messageId: 'm1',
        callId: 'call-1',
        tool: 'search',
        args: { q: 'weather' },
      });
      source.emit('chat.t1.tool_result', {
        threadId: 't1',
        messageId: 'm1',
        callId: 'call-1',
        tool: 'search',
        result: { ok: true },
      });
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'Sunny.' });
    });

    const segments = result.current['m1']?.segments;
    expect(segments).toEqual([
      { kind: 'text', content: 'Let me check. ' },
      { kind: 'tool', callId: 'call-1', tool: 'search', args: { q: 'weather' }, status: 'ok', result: { ok: true } },
      { kind: 'text', content: 'Sunny.' },
    ]);
  });

  it('resolves tool_result to the matching callId even when two calls to the same tool are in flight', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => {
      source.emit('chat.t1.tool_call', { threadId: 't1', messageId: 'm1', callId: 'call-a', tool: 'search', args: { q: 'a' } });
      source.emit('chat.t1.tool_call', { threadId: 't1', messageId: 'm1', callId: 'call-b', tool: 'search', args: { q: 'b' } });
      // Results arrive out of order relative to the calls.
      source.emit('chat.t1.tool_result', { threadId: 't1', messageId: 'm1', callId: 'call-b', tool: 'search', result: 'B' });
      source.emit('chat.t1.tool_result', { threadId: 't1', messageId: 'm1', callId: 'call-a', tool: 'search', result: 'A' });
    });

    const segments = result.current['m1']?.segments ?? [];
    const byCallId = Object.fromEntries(
      segments.filter((s) => s.kind === 'tool').map((s) => [(s as { callId?: string }).callId, s]),
    );
    expect((byCallId['call-a'] as { result?: unknown }).result).toBe('A');
    expect((byCallId['call-b'] as { result?: unknown }).result).toBe('B');
  });

  it('marks a tool segment errored on tool_validation_error', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => {
      source.emit('chat.t1.tool_call', { threadId: 't1', messageId: 'm1', callId: 'call-1', tool: 'write_file', args: {} });
      source.emit('chat.t1.tool_validation_error', {
        threadId: 't1',
        messageId: 'm1',
        callId: 'call-1',
        tool: 'write_file',
        error: 'path escapes sandbox',
      });
    });

    const segments = result.current['m1']?.segments ?? [];
    const toolSeg = segments.find((s) => s.kind === 'tool') as { status: string; error?: string };
    expect(toolSeg.status).toBe('error');
    expect(toolSeg.error).toBe('path escapes sandbox');
  });

  it('records context_trim notices without disturbing existing content', () => {
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: Wrapper });
    const source = getSource();

    act(() => {
      source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'hi' });
      source.emit('chat.t1.context_trim', {
        threadId: 't1',
        messageId: 'm1',
        dropped: 3,
        estimatedTokens: 900,
        contextWindow: 1000,
      });
    });

    const msg = result.current['m1'];
    expect(msg?.content).toBe('hi');
    expect(msg?.contextTrim).toEqual({ dropped: 3, estimatedTokens: 900, contextWindow: 1000 });
  });

  it('unsubscribes from all chat.<id>.* events when the threadId changes', () => {
    const { result, rerender } = renderHook(({ threadId }) => useChatStream(threadId), {
      wrapper: Wrapper,
      initialProps: { threadId: 't1' as string | null },
    });
    const source = getSource();

    expect(source.listenerCount('chat.t1.token')).toBeGreaterThan(0);

    act(() => rerender({ threadId: 't2' }));

    expect(source.listenerCount('chat.t1.token')).toBe(0);
    expect(source.listenerCount('chat.t2.token')).toBeGreaterThan(0);

    // Old-thread events no longer reach the (now stale) state for t1.
    act(() => source.emit('chat.t1.token', { threadId: 't1', messageId: 'm-old', delta: 'late' }));
    expect(result.current['m-old']).toBeUndefined();
  });
});

describe('useChatStream() — real initial-mount shape (regression for the SSE-race fix)', () => {
  // When a consumer of useRealtime().subscribe() mounts in the *same* commit
  // as <RealtimeProvider>, the provider's mount effect rebinds the
  // pre-created listener to the live EventSource, so delivery works. This
  // reproduces it for useChatStream specifically, mounting the hook directly
  // under RealtimeProvider with no deferral (unlike the rest of this file).
  it('accumulates tokens when RealtimeProvider and the hook mount in the same commit', () => {
    function DirectWrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <RealtimeProvider>{children}</RealtimeProvider>
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(() => useChatStream('t1'), { wrapper: DirectWrapper });
    const [source] = MockEventSource.instances;

    act(() => source.emit('chat.t1.token', { threadId: 't1', messageId: 'm1', delta: 'Hello' }));

    expect(result.current['m1']?.content).toBe('Hello');
  });
});
