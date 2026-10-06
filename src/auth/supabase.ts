import type { SupabaseClient } from '@supabase/supabase-js';

// The Supabase URL and *publishable* key are public by design: they end up in
// the browser bundle no matter where they are configured, and access is
// governed by Supabase Auth and Row Level Security. Never put the secret /
// service_role key in a VITE_ variable.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** False when Supabase isn't configured; the app then runs without login. */
export const isSupabaseConfigured = Boolean(url && key);

let client: Promise<SupabaseClient> | null = null;

/**
 * Loads supabase-js on demand (it is a separate chunk) so the map's first
 * paint isn't delayed by the auth library.
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (!isSupabaseConfigured) return Promise.reject(new Error('Supabase is not configured'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }),
  );
  return client;
}
