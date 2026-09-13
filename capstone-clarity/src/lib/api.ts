// Dev-only localhost fallback. In production `import.meta.env.DEV` is statically
// false, so the fallback literal never reaches the bundle; the vite.config.ts
// guard makes an unset VITE_INDEXER_API fail the build anyway.
const API =
  (import.meta.env["VITE_INDEXER_API"] as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export interface ApiErrorBody {
  error: { code: string; message: string; retryable: boolean };
}

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.code = body.error.code;
    this.retryable = body.error.retryable;
  }
}

/** All indexer numerics arrive as strings and stay strings. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    throw new ApiError((await res.json().catch(() => ({ error: { code: "HTTP", message: `HTTP ${res.status}`, retryable: false } }))) as ApiErrorBody);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError((await res.json().catch(() => ({ error: { code: "HTTP", message: `HTTP ${res.status}`, retryable: false } }))) as ApiErrorBody);
  }
  return (await res.json()) as T;
}
