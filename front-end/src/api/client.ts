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
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, payload?.code);
  }

  return payload as T;
}

export function eventStreamUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}
