import type { Config } from '@netlify/functions';
import { siteUrl } from '../lib/config';
import { internalToken } from '../lib/supabase';

// Starts the news digest agent once a day (scheduled functions may only run
// 30 s, so the work happens in the background function).
export default async () => {
  const res = await fetch(`${siteUrl()}/api/agents/news/run`, { method: 'POST', headers: { 'x-bri-internal': internalToken() } });
  console.log('News digest run requested:', res.status);
};

export const config: Config = { schedule: '0 6 * * *' }; // 06:00 UTC daily
