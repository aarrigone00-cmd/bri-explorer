import type { Config } from '@netlify/functions';
import { AgentError } from '../lib/errors';
import { errorResponse, json, notConfigured } from '../lib/http';
import { runNews } from '../lib/news/run';
import { authorizeRun } from '../lib/runs';

// Lets an admin publish a fresh news digest straight away (takes ~10 seconds).
export default async (req: Request) => {
  const missing = notConfigured();
  if (missing) return missing;
  try {
    const auth = await authorizeRun(req, 'news');
    if (!auth) throw new AgentError('Only site admins can run the news collector (or the daily limit was reached).', 403);
    return json(200, await runNews(auth.triggeredBy));
  } catch (err) {
    if (err instanceof Error && !(err instanceof AgentError) && /feeds?/.test(err.message)) return json(502, { error: err.message });
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/agents/news/run', method: 'POST' };
