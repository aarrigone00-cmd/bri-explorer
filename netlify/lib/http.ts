import { describeError } from './anthropic';
import { hasAnthropicKey, supabaseServiceKey } from './config';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function errorResponse(err: unknown): Response {
  const { status, message } = describeError(err);
  if (status >= 500) console.error(err);
  return json(status, { error: message });
}

/** Fails fast with a clear message when the site owner hasn't set the secrets yet. */
export function notConfigured(): Response | null {
  const missing = [!hasAnthropicKey() && 'ANTHROPIC_API_KEY', !supabaseServiceKey() && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  return missing.length ? json(503, { error: `The agents are not set up yet (missing ${missing.join(', ')} in Netlify).`, missing }) : null;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
