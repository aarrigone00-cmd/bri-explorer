import { projects } from '../data';
import { describeError } from '../errors';
import { finishRun, startRun } from '../runs';
import { adminClient } from '../supabase';
import { findingFor, watchQuery, type Article } from './detect';
import { GDELT_SPACING_MS, GdeltError, searchGdelt, sleep } from './gdelt';

// Agent 2, "Project Watcher": searches GDELT for recent coverage of every
// flagship project, one request every 5.5 seconds (~4 minutes in all), and
// files suggestions for an admin to approve. Nothing changes on the map until
// an admin approves a suggestion.

export async function runWatch(triggeredBy: string): Promise<void> {
  const db = adminClient();
  const runId = await startRun('watch', triggeredBy);
  try {
    // URLs seen in earlier runs, so only new articles count.
    const { data: log, error: logError } = await db.from('project_watch_log').select('project_id, sources').order('checked_at', { ascending: false }).limit(1000);
    if (logError) throw logError;
    const seen = new Map<string, Set<string>>();
    for (const row of log ?? []) {
      const set = seen.get(row.project_id) ?? new Set<string>();
      for (const s of (row.sources ?? []) as { url?: string }[]) if (s.url) set.add(s.url);
      seen.set(row.project_id, set);
    }
    const { data: pending, error: pendingError } = await db.from('project_update_suggestions').select('project_id, suggested_status').eq('review_status', 'pending');
    if (pendingError) throw pendingError;

    const today = new Date().toISOString().slice(0, 10);
    const failed: string[] = [];
    let checked = 0;
    let suggestions = 0;
    let refusedInARow = 0;
    for (const [i, p] of projects.entries()) {
      // Stop rather than keep hammering GDELT if it is refusing every request.
      if (refusedInARow >= 4) {
        failed.push(...projects.slice(i).map((x) => x.id));
        break;
      }
      if (i > 0) await sleep(GDELT_SPACING_MS);
      let articles: Article[];
      try {
        articles = await searchGdelt(watchQuery(p));
        refusedInARow = 0;
      } catch (err) {
        console.warn(`Watch: ${p.id} failed`, err);
        failed.push(p.id);
        if (err instanceof GdeltError && err.status === 429) refusedInARow += 1;
        continue;
      }
      checked += 1;
      const known = seen.get(p.id) ?? new Set<string>();
      const fresh = articles.filter((a) => !known.has(a.url));
      const finding = findingFor(p, fresh, today);
      // One pending suggestion per project and status is enough.
      const duplicate = finding && (pending ?? []).some((x) => x.project_id === p.id && x.suggested_status === finding.suggested_status);
      if (finding && !duplicate) {
        const { error } = await db.from('project_update_suggestions').insert({ ...finding, run_id: runId, model: 'gdelt-rules' });
        if (error) throw error;
        suggestions += 1;
      }
      const { error } = await db.from('project_watch_log').insert({
        project_id: p.id,
        run_id: runId,
        changed: Boolean(finding && !duplicate),
        summary: `${articles.length} articles in the past 14 days, ${fresh.length} new.`,
        sources: articles.map((a) => ({ url: a.url, title: a.title.slice(0, 300), publisher: a.domain })),
      });
      if (error) throw error;
    }
    await finishRun(runId, checked === 0 ? 'failed' : 'succeeded', { checked, suggestions, failed: failed.length, failed_projects: failed.slice(0, 50) });
  } catch (err) {
    console.error(err);
    await finishRun(runId, 'failed', { error: err instanceof Error ? err.message : describeError(err).message });
  }
}
