export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

export class ApiError extends Error {
  code: string;
  /** Server-minted ULID for the request that produced this error.
   *  Surfaced in the toast as `(req_01J…)` so support can grep logs. */
  requestId?: string;

  constructor(message: string, code = 'unknown', requestId?: string) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }

  /** Short suffix you can append to a user-facing message to help
   *  support correlate logs. Returns empty string when no requestId. */
  get supportSuffix(): string {
    if (!this.requestId) return '';
    return ` (req_${this.requestId.slice(0, 12)}…)`;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  const text = await response.text();
  let payload: T | null = null;
  // The backend mints an x-request-id header on every response (success
  // or error) — capture it so success-side errors and toasts that fire
  // from a successful response can still cite the request.
  const requestId =
    response.headers.get('x-request-id') ??
    response.headers.get('X-Request-Id') ??
    undefined;

  if (text) {
    try {
      payload = JSON.parse(text) as T;
    } catch {
      if (!response.ok) {
        throw new ApiError(
          `Request failed (${response.status}): Invalid JSON response`,
          'invalid_json',
          requestId,
        );
      }
    }
  }

  if (!response.ok) {
    const errorPayload = payload as Record<string, unknown> | null;
    // Prefer the body's requestId field (matches the structured-error
    // contract from the backend's `AppError::Internal` path); fall back
    // to the response header.
    const bodyRequestId =
      typeof errorPayload?.requestId === 'string'
        ? (errorPayload.requestId as string)
        : undefined;
    throw new ApiError(
      (errorPayload?.error as string) ?? `Request failed (${response.status})`,
      (errorPayload?.code as string) ?? 'request_failed',
      bodyRequestId ?? requestId,
    );
  }

  return payload!;
}

/**
 * Build an absolute URL for the SSE endpoint.
 *
 * ⚠️ Internal to the realtime layer. Do NOT call `new EventSource(eventStreamUrl(...))`
 * from a page or component — browsers cap an origin at 6 concurrent SSE
 * connections, and a page-local stream stacked with open chat threads exhausts
 * that cap and freezes navigation (see C312). The app must hold exactly one
 * `EventSource`, owned by `RealtimeProvider`. To react to backend events, use
 * `useRealtime().subscribe(name, handler)` instead.
 */
export function eventStreamUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}
