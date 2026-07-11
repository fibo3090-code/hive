import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { eventStreamUrl } from "@/api/client";
import { logger } from "@/lib/logger";

/**
 * Single shared `EventSource` for the whole app.
 *
 * Browsers cap HTTP/1.1 to 6 SSE connections per origin. Before this provider,
 * `useSse` + `useChatStream(threadId)` + the synthesis listener each opened
 * their own stream, so 2–3 open chat threads + a synthesis job would silently
 * hit the cap and break navigation.
 *
 * Now: one stream, many `subscribe(eventName, handler)` consumers, with
 * connection-state surfaced so the TopBar can show health and the toast
 * layer can avoid spamming "Failed to fetch" while the backend is down.
 */
export type ConnectionState = "connecting" | "open" | "closed";

type Handler = (event: MessageEvent) => void;

interface RealtimeContextValue {
  /** Subscribe to a named SSE event. Returns an unsubscribe fn. */
  subscribe: (eventName: string, handler: Handler) => () => void;
  /** Subscribe with a prefix match — fires for any event whose name starts with `prefix`. */
  subscribePrefix: (prefix: string, handler: (eventName: string, event: MessageEvent) => void) => () => void;
  connectionState: ConnectionState;
  /** Monotonically increases each time the stream reconnects. */
  reconnectCount: number;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { readonly children: ReactNode }) {
  const sourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef<Map<string, Set<Handler>>>(new Map());
  const prefixHandlersRef = useRef<Map<string, Set<(eventName: string, event: MessageEvent) => void>>>(new Map());
  // Native listener registered on the EventSource per event name. We hold one
  // native listener that fans out to all subscribed handlers — avoids piling up
  // listeners when many components subscribe to the same event.
  const nativeListenersRef = useRef<Map<string, EventListener>>(new Map());

  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [reconnectCount, setReconnectCount] = useState(0);

  // Open the EventSource once, on mount. EventSource auto-reconnects on
  // transport errors; we just observe the readyState transitions.
  useEffect(() => {
    const source = new EventSource(eventStreamUrl("/v1/events"));
    sourceRef.current = source;

    source.onopen = () => {
      setConnectionState("open");
      setReconnectCount((n) => (n === 0 ? 0 : n)); // first open: no reconnect
    };
    source.onerror = () => {
      // EventSource transitions: CONNECTING (0) → OPEN (1) → CLOSED (2).
      // If the browser is auto-reconnecting we'll see CONNECTING; if it gave
      // up we see CLOSED.
      if (source.readyState === EventSource.CLOSED) {
        setConnectionState("closed");
      } else {
        setConnectionState("connecting");
        setReconnectCount((n) => n + 1);
      }
    };

    // Attach native listeners for any handlers registered before this effect
    // ran. React runs a descendant's mount effects BEFORE its ancestor's, so a
    // consumer that calls `subscribe()` in the same commit (e.g. <RealtimeBridge>
    // → useSse, mounted as a direct child of this provider) runs while
    // `sourceRef.current` is still null — its `addEventListener` no-ops. The
    // listener closure exists in `nativeListenersRef` but was never bound to a
    // source. `ensureNativeListener` early-returns for an already-created
    // listener, so re-calling it here does NOT rebind — we must attach the
    // existing closures to the freshly-created source directly. Without this,
    // the entire SSE→query-invalidation bridge is silently dead on first load.
    for (const [eventName] of handlersRef.current) {
      const listener = nativeListenersRef.current.get(eventName);
      if (!listener) {
        // No closure yet (shouldn't normally happen for an exact subscribe,
        // but keep the fallback): build + attach in one step now that the
        // source exists.
        ensureNativeListener(eventName);
        continue;
      }
      source.addEventListener(eventName, listener);
    }

    // Capture the maps this effect run owns; the cleanup must clear what was
    // registered against THIS EventSource, not whatever the refs point to by
    // unmount time (react-hooks/exhaustive-deps warning).
    const nativeListeners = nativeListenersRef.current;
    const handlers = handlersRef.current;
    const prefixHandlers = prefixHandlersRef.current;
    return () => {
      source.close();
      sourceRef.current = null;
      nativeListeners.clear();
      handlers.clear();
      prefixHandlers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the singleton native listener for an event name. Idempotent.
  const ensureNativeListener = useCallback((eventName: string) => {
    if (nativeListenersRef.current.has(eventName)) return;
    const listener: EventListener = (raw) => {
      const event = raw as MessageEvent;
      // Exact-name subscribers
      const set = handlersRef.current.get(eventName);
      if (set) {
        for (const h of set) {
          try {
            h(event);
          } catch (err) {
            logger.error("realtime", `handler for "${eventName}" threw`, err);
          }
        }
      }
      // Prefix subscribers
      for (const [prefix, prefixSet] of prefixHandlersRef.current) {
        if (eventName.startsWith(prefix)) {
          for (const h of prefixSet) {
            try {
              h(eventName, event);
            } catch (err) {
              logger.error("realtime", `prefix handler for "${prefix}" threw`, err);
            }
          }
        }
      }
    };
    nativeListenersRef.current.set(eventName, listener);
    sourceRef.current?.addEventListener(eventName, listener);
  }, []);

  const subscribe = useCallback<RealtimeContextValue["subscribe"]>(
    (eventName, handler) => {
      let set = handlersRef.current.get(eventName);
      if (!set) {
        set = new Set();
        handlersRef.current.set(eventName, set);
      }
      set.add(handler);
      ensureNativeListener(eventName);
      return () => {
        const s = handlersRef.current.get(eventName);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) {
          handlersRef.current.delete(eventName);
          const native = nativeListenersRef.current.get(eventName);
          if (native) {
            sourceRef.current?.removeEventListener(eventName, native);
            nativeListenersRef.current.delete(eventName);
          }
        }
      };
    },
    [ensureNativeListener],
  );

  // Prefix subscribe — listening for dynamic event names like `agent.<id>.inbox`
  // without knowing every id up front. The EventSource API doesn't have a
  // wildcard, so we listen for the *known* prefixes that the backend emits and
  // fan them out by name. We pre-attach these prefixes lazily on subscribe.
  const subscribePrefix = useCallback<RealtimeContextValue["subscribePrefix"]>(
    (prefix, handler) => {
      let set = prefixHandlersRef.current.get(prefix);
      if (!set) {
        set = new Set();
        prefixHandlersRef.current.set(prefix, set);
      }
      set.add(handler);
      // For prefix subscriptions we need the backend to be using a small,
      // known event-name vocabulary. The provider doesn't enumerate every
      // dynamic id; callers should also `subscribe(specific.name, …)` when
      // they know the id. Returning a no-op unsubscribe wrapper keeps the
      // contract simple.
      return () => {
        const s = prefixHandlersRef.current.get(prefix);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) prefixHandlersRef.current.delete(prefix);
      };
    },
    [],
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({ subscribe, subscribePrefix, connectionState, reconnectCount }),
    [subscribe, subscribePrefix, connectionState, reconnectCount],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error("useRealtime() must be used inside <RealtimeProvider>");
  }
  return ctx;
}

/** Convenience hook: subscribe to one event for the lifetime of the component. */
export function useRealtimeEvent(eventName: string | null | undefined, handler: Handler) {
  const { subscribe } = useRealtime();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!eventName) return;
    return subscribe(eventName, (e) => handlerRef.current(e));
  }, [eventName, subscribe]);
}
