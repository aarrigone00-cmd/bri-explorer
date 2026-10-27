import type { Config } from '@netlify/functions';
import { notConfigured } from '../lib/http';
import { authorizeRun } from '../lib/runs';
import { runWatch } from '../lib/watch/run';

// Agent 2, "Project Watcher". A background function (up to 15 minutes), because
// GDELT is searched one project at a time.
export default async (req: Request) => {
  if (notConfigured()) return;
  const auth = await authorizeRun(req, 'watch');
  if (!auth) return;
  await runWatch(auth.triggeredBy);
};

export const config: Config = { path: '/api/agents/watch/run', method: 'POST', background: true };
