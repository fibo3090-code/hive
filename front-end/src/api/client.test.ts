import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, API_BASE_URL, eventStreamUrl } from './client';

/**
 * Builds a minimal fake `Response`-shaped object. `api()` only touches
 * `.ok`, `.status`, `.headers.get()` and `.text()`, so we don't need a real
 * `Response`/`fetch` polyfill — just something that duck-types correctly.
 */
function fakeResponse(opts: {
  status?: number;
  ok?: boolean;
  body?: string;
  headers?: Record<string, string>;
}) {
  const headers = new Map(Object.entries(opts.headers ?? {}));
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (key: string) => headers.get(key) ?? null },
    text: () => Promise.resolve(opts.body ?? ''),
  } as unknown as Response;
}

describe('api()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('joins the base URL and path, and resolves parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 200, ok: true, body: JSON.stringify({ hello: 'world' }) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<{ hello: string }>('/v1/things');

    expect(result).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/v1/things`);
  });

  it('sets Content-Type: application/json by default and forwards method/body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ body: 'null' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/v1/things', { method: 'POST', body: JSON.stringify({ a: 1 }) });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('lets caller-supplied headers override the default Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ body: 'null' }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/v1/upload', { headers: { 'Content-Type': 'multipart/form-data' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ 'Content-Type': 'multipart/form-data' });
  });

  it('returns null when the response body is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 204, ok: true, body: '' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<null>('/v1/things/1', { method: 'DELETE' });

    expect(result).toBeNull();
  });

  it('throws ApiError with the server error message and code on non-2xx JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 422,
        ok: false,
        body: JSON.stringify({ error: 'Title is required', code: 'validation_error' }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({
      message: 'Title is required',
      code: 'validation_error',
    });
    await expect(api('/v1/things')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to a generic message/code when the error body has neither', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 500, ok: false, body: JSON.stringify({}) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({
      message: 'Request failed (500)',
      code: 'request_failed',
    });
  });

  it('falls back to a generic message when the error body is empty text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 503, ok: false, body: '' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({
      message: 'Request failed (503)',
      code: 'request_failed',
    });
  });

  it('throws ApiError with code invalid_json when an error response body fails to parse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 500, ok: false, body: '<html>not json</html>' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({
      code: 'invalid_json',
      message: 'Request failed (500): Invalid JSON response',
    });
  });

  it('prefers the requestId embedded in the error body over the header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 400,
        ok: false,
        body: JSON.stringify({ error: 'bad', requestId: 'body-req-id' }),
        headers: { 'x-request-id': 'header-req-id' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({ requestId: 'body-req-id' });
  });

  it('falls back to the x-request-id header when the body has no requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 400,
        ok: false,
        body: JSON.stringify({ error: 'bad' }),
        headers: { 'x-request-id': 'header-req-id' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toMatchObject({ requestId: 'header-req-id' });
  });

  it('leaves requestId undefined when neither body nor header supply one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 400, ok: false, body: JSON.stringify({ error: 'bad' }) }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await api('/v1/things');
      throw new Error('expected api() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).requestId).toBeUndefined();
    }
  });

  it('propagates a rejected fetch (network failure / abort) without wrapping it', async () => {
    const networkError = new DOMException('The operation was aborted', 'AbortError');
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/v1/things')).rejects.toBe(networkError);
  });
});

describe('ApiError.supportSuffix', () => {
  it('renders a truncated (first 12 chars) request id suffix when one is present', () => {
    const err = new ApiError('boom', 'unknown', '0123456789ABCDEFGHIJK');
    expect(err.supportSuffix).toBe(' (req_0123456789AB…)');
  });

  it('is empty when there is no request id', () => {
    const err = new ApiError('boom');
    expect(err.supportSuffix).toBe('');
  });
});

describe('eventStreamUrl()', () => {
  it('joins the base URL with the given path', () => {
    expect(eventStreamUrl('/v1/events')).toBe(`${API_BASE_URL}/v1/events`);
  });
});
