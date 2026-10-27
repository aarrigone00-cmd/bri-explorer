import { AgentRequestError, agentStatus, callAgent } from '../agents/client';
import { getSupabase, isSupabaseConfigured } from '../auth/supabase';
import { STATUS_LABELS } from '../config';
import type { Store } from '../state/store';
import type { Dataset, ProjectUpdate } from '../types';
import { $, escapeHtml, safeUrl } from './dom';
import { renderMarkdown } from './markdown';

// Agents inside the profile dialog:
//  - Agent 3 "My Briefing": generate and show the user's personal briefing.
//  - Agent 2 "Project Watcher": admins review suggested project updates.
// Also loads admin status and the approved updates shown on project panels.

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function initAgentProfile(data: Dataset, store: Store): void {
  if (!isSupabaseConfigured) {
    document.getElementById('briefing-section')?.setAttribute('hidden', '');
    return;
  }
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]));

  // ---- Approved project updates (public) ---------------------------------------
  async function loadApprovedUpdates() {
    try {
      const sb = await getSupabase();
      const { data: rows, error } = await sb
        .from('project_update_suggestions')
        .select('*')
        .eq('review_status', 'approved')
        .order('reviewed_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const latest: Record<string, ProjectUpdate> = {};
      for (const r of (rows ?? []) as ProjectUpdate[]) if (!latest[r.project_id]) latest[r.project_id] = r;
      store.set({ projectUpdates: latest });
    } catch (err) {
      console.error('Could not load project updates', err);
    }
  }
  void loadApprovedUpdates();

  // ---- Admin status -------------------------------------------------------------
  async function checkAdmin() {
    const user = store.get().user;
    if (!user) return store.set({ isAdmin: false });
    try {
      const sb = await getSupabase();
      const { data: row } = await sb.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (store.get().user?.id === user.id) store.set({ isAdmin: Boolean(row) });
    } catch {
      store.set({ isAdmin: false });
    }
  }
  if (store.get().user) setTimeout(() => void checkAdmin(), 0);
  store.subscribe((s, prev) => {
    // Deferred: never call Supabase from inside its auth callback.
    if (s.user?.id !== prev.user?.id) setTimeout(() => void checkAdmin(), 0);
    if (s.isAdmin !== prev.isAdmin) $('#review-section').hidden = !s.isAdmin;
  });

  const message = (id: string, text: string, kind: 'error' | 'success' | 'info' = 'info') => {
    const el = $(id);
    el.textContent = text;
    el.className = `auth__message auth__message--${kind}`;
    el.hidden = !text;
  };

  // ---- My Briefing --------------------------------------------------------------
  const briefingBody = $('#briefing-body');
  const generate = $('#briefing-generate') as HTMLButtonElement;

  async function showLatestBriefing() {
    const user = store.get().user;
    if (!user) return;
    const status = await agentStatus();
    generate.disabled = !status.ready;
    if (!status.ready) message('#briefing-message', "The AI agents aren't switched on for this site yet.");
    try {
      const sb = await getSupabase();
      const { data: row } = await sb
        .from('user_briefings')
        .select('content, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      briefingBody.innerHTML = row
        ? `<p class="muted small">Generated ${escapeHtml(fmt(row.created_at))}</p>${renderMarkdown(row.content)}`
        : `<p class="muted small">Get a one-page AI briefing on your region of interest, saved items and the latest news. Up to 3 per day.</p>`;
    } catch (err) {
      console.error(err);
    }
  }

  generate.addEventListener('click', async () => {
    generate.disabled = true;
    generate.textContent = 'Writing…';
    message('#briefing-message', 'Writing your briefing. This usually takes 15–40 seconds.');
    try {
      const res = await callAgent<{ content: string; created_at: string; truncated?: boolean }>('/api/agents/briefing');
      briefingBody.innerHTML = `<p class="muted small">Generated ${escapeHtml(fmt(res.created_at))}</p>${renderMarkdown(res.content)}`;
      message('#briefing-message', '');
    } catch (err) {
      message('#briefing-message', err instanceof AgentRequestError ? err.message : 'Could not generate the briefing.', 'error');
    } finally {
      generate.disabled = false;
      generate.textContent = 'Generate';
    }
  });

  // ---- Project Watcher review (admins) ------------------------------------------
  const list = $('#review-list');
  let pending: ProjectUpdate[] = [];

  async function loadReview() {
    if (!store.get().isAdmin) return;
    try {
      const sb = await getSupabase();
      const [{ data: rows, error }, { data: run }] = await Promise.all([
        sb.from('project_update_suggestions').select('*').eq('review_status', 'pending').order('created_at', { ascending: false }).limit(50),
        sb.from('agent_runs').select('status, started_at, finished_at, detail').eq('agent', 'watch').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (error) throw error;
      pending = (rows ?? []) as ProjectUpdate[];
      const d = (run?.detail ?? {}) as { checked?: number; suggestions?: number; error?: string };
      $('#watch-last').textContent = run
        ? `Last run ${fmt(run.started_at)}: ${run.status}${run.status === 'succeeded' ? `, checked ${d.checked ?? '?'} projects, ${d.suggestions ?? 0} new suggestion(s)` : d.error ? ` (${d.error})` : ''}.`
        : 'The Project Watcher runs every Monday. It hasn’t run yet.';
      renderReview();
    } catch (err) {
      message('#review-message', `Could not load suggestions: ${(err as Error).message}`, 'error');
    }
  }

  function renderReview() {
    $('#review-count').textContent = pending.length ? `(${pending.length})` : '';
    list.innerHTML = pending.length
      ? pending
          .map(
            (s) => `<li class="review">
          <div class="review__head"><strong>${escapeHtml(projectName.get(s.project_id) ?? s.project_id)}</strong>
            <span class="muted small">${escapeHtml(STATUS_LABELS[s.current_status] ?? s.current_status)} → <strong>${escapeHtml(STATUS_LABELS[s.suggested_status] ?? s.suggested_status)}</strong>${s.as_of ? ` · as of ${escapeHtml(s.as_of)}` : ''}</span></div>
          ${s.status_note ? `<p class="small">${escapeHtml(s.status_note)}</p>` : ''}
          ${s.summary ? `<p class="small muted">${escapeHtml(s.summary)}</p>` : ''}
          <p class="small">${s.sources.map((src) => `<a href="${escapeHtml(safeUrl(src.url))}" target="_blank" rel="noopener">${escapeHtml(src.publisher || src.title)}</a>`).join(' · ')}</p>
          <div class="review__actions">
            <button type="button" class="chip-button chip-button--small" data-review="approved" data-id="${s.id}">Approve</button>
            <button type="button" class="chip-button chip-button--small" data-review="rejected" data-id="${s.id}">Reject</button>
          </div>
        </li>`,
          )
          .join('')
      : `<li class="muted small">Nothing to review.</li>`;
  }

  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-review]');
    const user = store.get().user;
    if (!btn || !user) return;
    btn.disabled = true;
    try {
      const sb = await getSupabase();
      const { error } = await sb
        .from('project_update_suggestions')
        .update({ review_status: btn.dataset.review, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq('id', btn.dataset.id!);
      if (error) throw error;
      pending = pending.filter((p) => p.id !== btn.dataset.id);
      renderReview();
      message('#review-message', btn.dataset.review === 'approved' ? 'Approved. The update now shows on the project panel.' : 'Rejected.', 'success');
      if (btn.dataset.review === 'approved') void loadApprovedUpdates();
    } catch (err) {
      btn.disabled = false;
      message('#review-message', `Could not save: ${(err as Error).message}`, 'error');
    }
  });

  $('#watch-run').addEventListener('click', async () => {
    const btn = $('#watch-run') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await callAgent('/api/agents/watch/run');
      message('#review-message', 'Project Watcher started. It takes a few minutes; reopen your profile later to see suggestions.', 'success');
    } catch (err) {
      message('#review-message', err instanceof AgentRequestError ? err.message : 'Could not start the Project Watcher.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.addEventListener('bri:open-profile', () => {
    setTimeout(() => {
      void showLatestBriefing();
      void loadReview();
    }, 0);
  });
}
