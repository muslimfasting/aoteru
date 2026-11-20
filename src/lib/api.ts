/**
 * Thin fetch wrapper for the game API.
 *
 * - Same-origin, cookie session.
 * - Non-2xx answers are thrown as `ApiError` carrying the server's message.
 * - Every mutation sends an Idempotency-Key so a retried action is applied once.
 */
import type { ApiErrorBody } from '@/game/api';
import { bus } from './events';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Reuse the same key when retrying the same user action. */
  idempotencyKey?: string;
}

async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
  }

  const send = () =>
    fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: opts.signal,
    });

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (method !== 'POST') throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    // A dropped connection may or may not have reached the server. Retry the
    // same action once with the same Idempotency-Key so it is applied at most once.
    await new Promise((resolve) => setTimeout(resolve, 700));
    try {
      res = await send();
    } catch (retryErr) {
      if (retryErr instanceof DOMException && retryErr.name === 'AbortError') throw retryErr;
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    }
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? (res.status >= 500 ? 'The server stumbled. Please try again in a moment.' : `Request failed (${res.status}).`),
    );
    if (res.status === 401) bus.emit('auth:unauthorized', {});
    throw apiError;
  }
  return data as T;
}

export function apiGet<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return request<T>('GET', path, undefined, opts);
}

export function apiPost<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  return request<T>('POST', path, body, opts);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
