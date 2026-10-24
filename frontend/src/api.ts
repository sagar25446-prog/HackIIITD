// Thin client for the JAAGRUK API.
export type Profile = Record<string, any>;

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j.detail || j.error || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  get: <T,>(p: string) => req<T>("GET", p),
  post: <T,>(p: string, b?: unknown) => req<T>("POST", p, b ?? {}),
  del: <T,>(p: string) => req<T>("DELETE", p),
};

/** Subscribe to a server-sent event stream. Returns a close function. */
export function stream(path: string, onEvent: (ev: any) => void, onEnd?: (result: any) => void): () => void {
  const es = new EventSource(path);
  es.onmessage = (m) => {
    try {
      const ev = JSON.parse(m.data);
      if (ev.phase !== "heartbeat") onEvent(ev);
    } catch {
      /* ignore */
    }
  };
  es.addEventListener("end", (m: MessageEvent) => {
    try {
      onEnd?.(JSON.parse(m.data).result);
    } catch {
      onEnd?.(null);
    }
    es.close();
  });
  es.onerror = () => {
    // never let the browser auto-reconnect: a reconnect would start the server-side work again
    es.close();
    onEnd?.(null);
  };
  return () => es.close();
}

export const inr = (n: number | null | undefined, compact = false) => {
  const v = Math.round(n || 0);
  if (compact && v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)} lakh`;
  return "₹" + v.toLocaleString("en-IN");
};

export const ago = (ts: number) => {
  const s = Date.now() / 1000 - ts;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
