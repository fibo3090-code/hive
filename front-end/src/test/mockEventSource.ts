/**
 * Minimal, controllable fake for the browser `EventSource` API — jsdom does
 * not implement SSE. Assign `MockEventSource` to `globalThis.EventSource`
 * (e.g. via `vi.stubGlobal`) in a `beforeEach`, then drive connection state
 * and dispatch named events with `simulateOpen` / `simulateError` / `emit`.
 *
 * Kept intentionally dumb: it does not simulate real network behavior
 * (retries, backoff) — callers drive every transition explicitly so tests
 * stay deterministic.
 */
type Listener = (event: MessageEvent) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials: boolean;
  readyState: number = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    this.url = url;
    this.withCredentials = eventSourceInitDict?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  /** Test helper: simulate the transport establishing a connection. */
  simulateOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  /**
   * Test helper: simulate a transport error. Defaults to the browser's
   * "still retrying" state (CONNECTING); pass CLOSED to simulate the
   * browser giving up permanently.
   */
  simulateError(nextReadyState: number = MockEventSource.CONNECTING): void {
    this.readyState = nextReadyState;
    this.onerror?.(new Event('error'));
  }

  /** Test helper: dispatch a named SSE event to every registered listener. */
  emit(type: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    const event = new MessageEvent(type, { data: payload });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  /** Number of native listeners currently registered for `type`. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  static reset(): void {
    MockEventSource.instances = [];
  }
}
