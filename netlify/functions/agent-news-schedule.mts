import type { Config } from '@netlify/functions';
import { supabaseServiceKey } from '../lib/config';
import { runNews } from '../lib/news/run';

// Publishes the weekly "China & the World" digest from free RSS feeds.
export default async () => {
  if (!supabaseServiceKey()) return console.warn('News digest skipped: SUPABASE_SERVICE_ROLE_KEY is not set.');
  try {
    console.log('News digest published:', await runNews('schedule'));
  } catch (err) {
    console.error('News digest failed:', err);
  }
};

// Thursdays 06:00 UTC; each run covers the past 7 days. Thursday (not Monday,
// when the Project Watcher runs) keeps the Supabase project active every few
// days so it isn't paused for inactivity. Edit the cron to change the frequency.
export const config: Config = { schedule: '0 6 * * 4' };
