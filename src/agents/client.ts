import { getSupabase, isSupabaseConfigured } from '../auth/supabase';

// Browser side of the agents: calls the Netlify functions with the signed-in
// user's Supabase access token. No AI keys ever reach the browser.

export interface AgentStatus {
  ready: boolean;
  anthropic: boolean;
  supabase: boolean;
}

let statusPromise: Promise<AgentStatus> | null = null;

/** Whether the server has its keys configured (cached for the page view). */
export function agentStatus(): Promise<AgentStatus> {
  statusPromise ??= fetch('/api/agents/status')
    .then((r) => (r.ok ? (r.json() as Promise<AgentStatus>) : { ready: false, anthropic: false, supabase: false }))
    .catch(() => ({ ready: false, anthropic: false, supabase: false }));
  return statusPromise;
}

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
  if (!token) throw new AgentRequestError('Please sign in to use the agents.', 401);
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
    if ((err as Error).name === 'AbortError') throw new AgentRequestError('The agent took too long to answer. Please try again.', 504);
    throw new AgentRequestError('Could not reach the agent. Check your connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
}
