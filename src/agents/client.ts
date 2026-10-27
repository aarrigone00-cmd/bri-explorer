import { getSupabase, isSupabaseConfigured } from '../auth/supabase';

// Browser side of the admin-only agent runs (news collector, Project Watcher):
// calls the Netlify functions with the signed-in user's Supabase access token.
// No secret ever reaches the browser.

export class AgentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function accessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** POSTs to an agent endpoint and returns its JSON, throwing readable errors. */
export async function callAgent<T>(path: string, body: unknown = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
  const token = await accessToken();
  if (!token) throw new AgentRequestError('Please sign in first.', 401);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 70_000);
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status === 202) return {} as T; // background function accepted
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new AgentRequestError(data.error || `Request failed (${res.status}).`, res.status);
    return data as T;
  } catch (err) {
    if (err instanceof AgentRequestError) throw err;
    if ((err as Error).name === 'AbortError') throw new AgentRequestError('The request took too long. Please try again.', 504);
    throw new AgentRequestError('Could not reach the server. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
}
