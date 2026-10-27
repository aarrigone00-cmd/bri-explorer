import type { Config } from '@netlify/functions';
import { MODEL, createClaudeClient, describeError } from '../lib/anthropic';
import { runNewsDigest } from '../lib/agents/news';
import { notConfigured } from '../lib/http';
import { authorizeRun, finishRun, startRun } from '../lib/runs';
import { adminClient } from '../lib/supabase';

// Agent 4, "China & the World": researches the week's China foreign-policy news
// with web search and stores a cited digest. Background function (15 min limit):
// the caller gets 202 immediately and the site reads the result from Supabase.
export default async (req: Request) => {
  if (notConfigured()) return;
  const auth = await authorizeRun(req, 'news');
  if (!auth) return;
  const db = adminClient();
  const runId = await startRun('news', auth.triggeredBy);
  const { data: row, error } = await db.from('news_digests').insert({ status: 'running', model: MODEL, run_id: runId }).select('id').single();
  if (error) {
    await finishRun(runId, 'failed', { error: error.message });
    return;
  }
  try {
    const digest = await runNewsDigest(createClaudeClient());
    await db
      .from('news_digests')
      .update({ status: 'ready', overview: digest.overview, items: digest.items, search_count: digest.searches, completed_at: new Date().toISOString() })
      .eq('id', row.id);
    await finishRun(runId, 'succeeded', { digest_id: row.id, items: digest.items.length, searches: digest.searches });
  } catch (err) {
    const message = describeError(err).message;
    console.error(err);
    await db.from('news_digests').update({ status: 'error', error: message, completed_at: new Date().toISOString() }).eq('id', row.id);
    await finishRun(runId, 'failed', { error: message });
  }
};

export const config: Config = { path: '/api/agents/news/run', method: 'POST', background: true };
