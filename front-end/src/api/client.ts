const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787';

export class ApiError extends Error {
  code: string;

  constructor(message: string, code = 'unknown') {
    super(message);
    this.code = code;
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

  if (text) {
    try {
      payload = JSON.parse(text) as T;
    } catch {
      if (!response.ok) {
        throw new ApiError(`Request failed (${response.status}): Invalid JSON response`, 'invalid_json');
      }
    }
  }

  if (!response.ok) {
    throw new ApiError(payload ? (payload as { error?: string })?.error ?? `Request failed (${response.status})` : `Request failed (${response.status})`, payload ? (payload as { code?: string })?.code : 'request_failed');
  }

  return payload as T;
}

export function eventStreamUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}
