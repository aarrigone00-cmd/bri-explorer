// Server-side configuration for the agent functions. Secrets come only from
// Netlify environment variables (Site settings → Environment variables); they
// are never bundled into the browser code.

/** Claude model used by every agent. Override with the AGENT_MODEL env var. */
export const MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';

// The Supabase URL and publishable key are public values (also in the
// frontend). netlify.toml [build.environment] values are not available to
// functions at runtime, so they are repeated here as defaults.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wfgcnwsfftjsgqtcwlyd.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_iEe8hTQ9fdIOsSSJe1KJIw_PXj0IMN7';

/** Secret: Supabase service-role / secret key, used to write agent results. */
export const supabaseServiceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

/** Secret: Anthropic API key (read by the SDK from ANTHROPIC_API_KEY). */
export const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Per-user daily limits for the interactive agents (cost protection). */
export const DAILY_LIMITS = {
  ask: Number(process.env.AGENT_ASK_DAILY_LIMIT || 30),
  briefing: Number(process.env.AGENT_BRIEFING_DAILY_LIMIT || 3),
  // Admin-triggered manual runs of the background agents.
  news: 3,
  watch: 2,
} as const;

export type AgentName = keyof typeof DAILY_LIMITS;

/** Public site URL, used by scheduled functions to call background functions. */
export const siteUrl = () => process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';
