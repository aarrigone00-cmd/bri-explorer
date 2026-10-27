import type { Config } from '@netlify/functions';
import { siteUrl } from '../lib/config';
import { internalToken } from '../lib/supabase';

// Starts the news digest agent once a week (scheduled functions may only run
// 30 s, so the work happens in the background function).
export default async () => {
  const res = await fetch(`${siteUrl()}/api/agents/news/run`, { method: 'POST', headers: { 'x-bri-internal': internalToken() } });
  console.log('News digest run requested:', res.status);
};

// Thursdays 06:00 UTC; each run covers the past 7 days. Thursday (not Monday,
// when the Project Watcher runs) keeps the Supabase project active every few
// days so it isn't paused for inactivity. Edit the cron to change the frequency.
export const config: Config = { schedule: '0 6 * * 4' };
