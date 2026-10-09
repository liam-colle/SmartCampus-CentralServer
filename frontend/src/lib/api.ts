export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Init = {
  method?: string;
  /** JSON body. */
  body?: unknown;
  /** Raw text body, sent as text/csv (used by the CSV import). */
  csv?: string;
};

// Called when the server says the session is gone (expired, revoked, account disabled).
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/** JSON fetch helper. The session cookie is httpOnly, so the browser attaches it by itself. */
export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const hasBody = init.body !== undefined || init.csv !== undefined;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: init.csv !== undefined
      ? { "Content-Type": "text/csv" }
      : init.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: init.csv ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A failed login/me is a normal "not signed in", not an expired session.
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return data as T;
}
