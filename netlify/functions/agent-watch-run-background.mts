import type { Config } from '@netlify/functions';
import { MODEL, createClaudeClient, describeError } from '../lib/anthropic';
import { pickProjects, runWatch } from '../lib/agents/watch';
import { projects } from '../lib/data';
import { notConfigured } from '../lib/http';
import { authorizeRun, finishRun, startRun } from '../lib/runs';
import { adminClient } from '../lib/supabase';

// Agent 2, "Project Watcher": checks recent news on flagship projects and files
// suggested status updates for an admin to approve. Background function.
export default async (req: Request) => {
  if (notConfigured()) return;
  const auth = await authorizeRun(req, 'watch');
  if (!auth) return;
  const db = adminClient();
  const runId = await startRun('watch', auth.triggeredBy);
  try {
    const { data: log, error: logError } = await db.from('project_watch_log').select('project_id, checked_at').order('checked_at', { ascending: false }).limit(500);
    if (logError) throw logError;
    const lastChecked = new Map<string, string>();
    for (const row of log ?? []) if (!lastChecked.has(row.project_id)) lastChecked.set(row.project_id, row.checked_at);

    const list = pickProjects(lastChecked);
    const { findings, failed } = await runWatch(createClaudeClient(), list);

    if (findings.length) {
      const { error } = await db.from('project_watch_log').insert(
        findings.map((f) => ({ project_id: f.project_id, run_id: runId, changed: f.changed, summary: f.summary, sources: f.sources })),
      );
      if (error) throw error;
    }
    // File suggestions, skipping ones identical to a suggestion still awaiting review.
    const { data: pending } = await db.from('project_update_suggestions').select('project_id, suggested_status, status_note').eq('review_status', 'pending');
    const isDuplicate = (id: string, status: string, note: string) =>
      (pending ?? []).some((p) => p.project_id === id && p.suggested_status === status && p.status_note === note);
    const suggestions = findings
      .filter((f) => f.changed && projects.some((p) => p.id === f.project_id))
      .filter((f) => !isDuplicate(f.project_id, f.suggested_status, f.status_note))
      .map((f) => ({
        project_id: f.project_id,
        current_status: f.current_status,
        suggested_status: f.suggested_status,
        status_note: f.status_note,
        summary: f.summary,
        as_of: f.as_of,
        sources: f.sources,
        run_id: runId,
        model: MODEL,
      }));
    if (suggestions.length) {
      const { error } = await db.from('project_update_suggestions').insert(suggestions);
      if (error) throw error;
    }
    await finishRun(runId, failed.length && !findings.length ? 'failed' : 'succeeded', {
      checked: list.length,
      findings: findings.length,
      suggestions: suggestions.length,
      failed,
    });
  } catch (err) {
    console.error(err);
    await finishRun(runId, 'failed', { error: describeError(err).message });
  }
};

export const config: Config = { path: '/api/agents/watch/run', method: 'POST', background: true };
