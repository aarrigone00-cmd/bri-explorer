import type { Config } from '@netlify/functions';
import { MODEL, hasAnthropicKey, supabaseServiceKey } from '../lib/config';
import { json } from '../lib/http';

// Tells the site which agents can run (booleans only; never reveals secrets).
export default async () =>
  json(200, {
    ready: hasAnthropicKey() && Boolean(supabaseServiceKey()),
    anthropic: hasAnthropicKey(),
    supabase: Boolean(supabaseServiceKey()),
    model: MODEL,
  });

export const config: Config = { path: '/api/agents/status', method: 'GET' };
