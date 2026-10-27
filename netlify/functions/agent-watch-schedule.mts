import type { Config } from '@netlify/functions';
import { siteUrl } from '../lib/config';
import { internalToken } from '../lib/supabase';

// Starts the Project Watcher once a week.
export default async () => {
  const res = await fetch(`${siteUrl()}/api/agents/watch/run`, { method: 'POST', headers: { 'x-bri-internal': internalToken() } });
  console.log('Project watcher run requested:', res.status);
};

export const config: Config = { schedule: '0 7 * * 1' }; // Mondays 07:00 UTC
