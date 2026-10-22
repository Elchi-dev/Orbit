async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `${res.status}`);
  return data as T;
}

export const api = {
  get: <T,>(p: string) => req<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => req<T>("POST", p, b ?? {}),
  put: <T,>(p: string, b: unknown) => req<T>("PUT", p, b),
  patch: <T,>(p: string, b: unknown) => req<T>("PATCH", p, b),
  del: <T,>(p: string) => req<T>("DELETE", p),
};

export async function ensureSession() {
  // in dev the page comes from Vite, so ask the server for the session cookie
  try {
    await fetch("/api/session", { credentials: "same-origin" });
  } catch {}
}
