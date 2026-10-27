import type { Config } from '@netlify/functions';
import type { Profile } from '../../src/types';
import { AgentError, MODEL, createClaudeClient } from '../lib/anthropic';
import { runBriefing } from '../lib/agents/briefing';
import type { DigestItem } from '../lib/agents/news';
import { errorResponse, json, notConfigured } from '../lib/http';
import { adminClient, requireUser, useQuota } from '../lib/supabase';

// Agent 3, "My Briefing": a personal briefing from the user's profile.
export default async (req: Request) => {
  const missing = notConfigured();
  if (missing) return missing;
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    if (!profile) throw new AgentError('Your profile could not be found. Open your profile once, then try again.', 404);
    await useQuota(user.id, 'briefing');

    const { data: digest } = await db
      .from('news_digests')
      .select('items')
      .eq('status', 'ready')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { markdown, truncated } = await runBriefing(createClaudeClient(), profile as Profile, (digest?.items as DigestItem[] | undefined) ?? []);
    if (!markdown) throw new AgentError('The briefing came back empty. Please try again.', 502);
    const { data: saved, error: saveError } = await db
      .from('user_briefings')
      .insert({ user_id: user.id, content: markdown, model: MODEL })
      .select('id, content, created_at')
      .single();
    if (saveError) throw saveError;
    return json(200, { ...saved, truncated });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/agents/briefing', method: 'POST' };
