import { adminClient, isAdmin, isInternalCall, requireUser, useQuota } from './supabase';
import type { AgentName } from './config';

/** Who may start a background agent run: the scheduler, or a signed-in admin. */
export async function authorizeRun(req: Request, agent: AgentName): Promise<{ triggeredBy: string } | null> {
  if (isInternalCall(req)) return { triggeredBy: 'schedule' };
  try {
    const user = await requireUser(req);
    if (!(await isAdmin(user.id))) return null;
    await useQuota(user.id, agent);
    return { triggeredBy: user.id };
  } catch {
    return null;
  }
}

export async function startRun(agent: string, triggeredBy: string): Promise<string> {
  const { data, error } = await adminClient().from('agent_runs').insert({ agent, triggered_by: triggeredBy }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function finishRun(id: string, status: 'succeeded' | 'failed', detail: Record<string, unknown>) {
  const { error } = await adminClient().from('agent_runs').update({ status, detail, finished_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error('Could not record run result', error);
}
