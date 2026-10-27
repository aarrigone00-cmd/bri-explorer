import { USER_AGENT, supabaseServiceKey } from './config';
import { describeError } from './errors';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function errorResponse(err: unknown): Response {
  const { status, message } = describeError(err);
  if (status >= 500) console.error(err);
  return json(status, { error: message });
}

/** Fails fast with a clear message when the site owner hasn't set the secret yet. */
export function notConfigured(): Response | null {
  return supabaseServiceKey()
    ? null
    : json(503, { error: 'The agents are not set up yet (missing SUPABASE_SERVICE_ROLE_KEY in Netlify).', missing: ['SUPABASE_SERVICE_ROLE_KEY'] });
}

/** fetch with a timeout and the site's User-Agent. */
export async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}
