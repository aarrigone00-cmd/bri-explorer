import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AgentError } from './errors';
import { DAILY_LIMITS, SUPABASE_URL, supabaseServiceKey, type AgentName } from './config';

let admin: SupabaseClient | null = null;

/** Service-role client: bypasses RLS, so only ever used server-side. */
export function adminClient(): SupabaseClient {
  const key = supabaseServiceKey();
  if (!key) throw new AgentError('Server is missing SUPABASE_SERVICE_ROLE_KEY.', 500);
  admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export interface AuthedUser {
  id: string;
  email: string;
}

/** Verifies the Supabase access token sent as "Authorization: Bearer …". */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AgentError('Please sign in to use the agents.', 401);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new AgentError('Your session has expired. Please sign in again.', 401);
  return { id: data.user.id, email: data.user.email ?? '' };
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await adminClient().from('app_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Counts today's uses and records one more, or throws 429 if over the limit. */
export async function useQuota(userId: string, agent: AgentName): Promise<{ used: number; limit: number }> {
  const limit = DAILY_LIMITS[agent];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const db = adminClient();
  const { count, error } = await db
    .from('agent_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('agent', agent)
    .gte('created_at', since);
  if (error) throw error;
  if ((count ?? 0) >= limit) {
    throw new AgentError(`You've reached today's limit for this agent (${limit} per 24 hours). Please try again later.`, 429);
  }
  const { error: insertError } = await db.from('agent_usage').insert({ user_id: userId, agent });
  if (insertError) throw insertError;
  return { used: (count ?? 0) + 1, limit };
}

/**
 * Shared secret for scheduled → background function calls, derived from the
 * service key so no extra environment variable is needed.
 */
export function internalToken(): string {
  return createHash('sha256').update(`bri-internal:${supabaseServiceKey()}`).digest('hex');
}

export function isInternalCall(req: Request): boolean {
  const got = req.headers.get('x-bri-internal') ?? '';
  const want = internalToken();
  return supabaseServiceKey() !== '' && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
