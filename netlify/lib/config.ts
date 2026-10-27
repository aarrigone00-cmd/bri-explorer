// Server-side configuration for the agent functions. The only secret is the
// Supabase service key, set in Netlify (Site settings → Environment variables).
// The agents use free public sources (news RSS feeds and the GDELT API); no
// AI service or paid API is involved.

// The Supabase URL and publishable key are public values (also in the
// frontend). netlify.toml [build.environment] values are not available to
// functions at runtime, so they are repeated here as defaults.
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wfgcnwsfftjsgqtcwlyd.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_iEe8hTQ9fdIOsSSJe1KJIw_PXj0IMN7';

/** Secret: Supabase service-role / secret key, used to save agent results. */
export const supabaseServiceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

/** Admin-triggered manual runs per admin per 24 hours (be polite to free sources). */
export const DAILY_LIMITS = {
  news: 5,
  watch: 2,
} as const;

export type AgentName = keyof typeof DAILY_LIMITS;

/** Public site URL, used by scheduled functions to call background functions. */
export const siteUrl = () => process.env.URL || process.env.DEPLOY_PRIME_URL || 'http://localhost:8888';

/** Identifies the site to the free services it reads from. */
export const USER_AGENT = 'BRI-Explorer/1.0 (educational project; https://bri-explorer.netlify.app)';
