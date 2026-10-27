import type { Config } from '@netlify/functions';
import { createClaudeClient } from '../lib/anthropic';
import { runAsk, sanitizeHistory } from '../lib/agents/ask';
import { errorResponse, json, notConfigured, readJson } from '../lib/http';
import { requireUser, useQuota } from '../lib/supabase';

// Agent 1, "Ask the Map": answers questions from the site's data and moves the map.
export default async (req: Request) => {
  const missing = notConfigured();
  if (missing) return missing;
  try {
    const body = await readJson(req);
    const history = sanitizeHistory(body.messages);
    const user = await requireUser(req);
    const quota = await useQuota(user.id, 'ask');
    const result = await runAsk(createClaudeClient(), history);
    return json(200, { ...result, quota });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/agents/ask', method: 'POST' };
