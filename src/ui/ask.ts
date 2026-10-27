import { AgentRequestError, agentStatus, callAgent } from '../agents/client';
import { isSupabaseConfigured } from '../auth/supabase';
import type { Store } from '../state/store';
import type { LayerKey } from '../types';
import { $, escapeHtml } from './dom';
import { renderMarkdown } from './markdown';

// Agent 1 UI: a chat panel over the map. Replies can move the map.

type MapAction =
  | { action: 'focus_country'; iso3: string }
  | { action: 'focus_project'; id: string }
  | { action: 'focus_record'; id: number }
  | { action: 'set_year'; year: number }
  | { action: 'show_layers'; layers: string[] };

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Which countries received the most Chinese loans for railways?',
  'What is the China–Pakistan Economic Corridor?',
  'Show me Kenya and summarise its BRI projects',
  'How has BRI engagement changed since 2021?',
];

export function initAsk(store: Store): void {
  const panel = $('#ask-panel');
  const toggle = $('#ask-toggle');
  const log = $('#ask-log');
  const form = $('#ask-form') as HTMLFormElement;
  const input = $('#ask-input') as HTMLTextAreaElement;
  const send = $('#ask-send') as HTMLButtonElement;
  const notice = $('#ask-notice');
  const history: Turn[] = [];
  let busy = false;

  if (!isSupabaseConfigured) {
    toggle.hidden = true;
    return;
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('has-ask', open);
    if (open) {
      // Share the left side of the map with the layers panel: close it.
      const filters = document.getElementById('filters-panel');
      if (filters && !filters.hidden) document.getElementById('filters-toggle')?.click();
      renderNotice();
      if (store.get().user) input.focus();
    }
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden !== false));
  // Opening the layers panel closes this one (they share the same space).
  document.getElementById('filters-toggle')?.addEventListener('click', () => {
    if (!panel.hidden && document.getElementById('filters-panel')?.hidden === false) setOpen(false);
  });
  $('#ask-close').addEventListener('click', () => setOpen(false));

  async function renderNotice() {
    const user = store.get().user;
    const status = await agentStatus();
    if (!status.ready) {
      notice.innerHTML = `<p class="muted small">The AI agents aren't switched on for this site yet.</p>`;
    } else if (!user) {
      notice.innerHTML = `<p class="small">Sign in to ask questions about the map. <button type="button" class="inline-link" data-ask-login>Sign in</button></p>`;
    } else {
      notice.innerHTML = '';
    }
    const enabled = status.ready && Boolean(user);
    input.disabled = !enabled || busy;
    send.disabled = !enabled || busy;
    if (!history.length) renderWelcome(enabled);
  }
  notice.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ask-login]')) document.dispatchEvent(new CustomEvent('bri:open-login'));
  });
  store.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id && !panel.hidden) void renderNotice();
  });

  function renderWelcome(enabled: boolean) {
    log.innerHTML = `
      <div class="ask__welcome">
        <p>Ask anything about the Belt and Road data on this site. Answers come from the site's sources, and I can move the map to show you.</p>
        ${enabled ? `<div class="ask__chips">${SUGGESTIONS.map((q) => `<button type="button" class="ask__chip" data-suggest="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>` : ''}
      </div>`;
  }
  log.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-suggest]');
    if (chip && !busy) void ask(chip.dataset.suggest!);
  });

  function append(role: Turn['role'] | 'error', html: string): HTMLElement {
    log.querySelector('.ask__welcome')?.remove();
    const el = document.createElement('div');
    el.className = `ask__msg ask__msg--${role}`;
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function applyActions(actions: MapAction[]) {
    for (const a of actions) {
      if (a.action === 'focus_country') store.set({ selection: { kind: 'country', iso3: a.iso3 } });
      else if (a.action === 'focus_project') store.set({ selection: { kind: 'project', id: a.id } });
      else if (a.action === 'focus_record') store.set({ selection: { kind: 'record', id: a.id } });
      else if (a.action === 'set_year') store.set({ year: a.year });
      else if (a.action === 'show_layers') {
        const layers = { ...store.get().layers };
        for (const k of Object.keys(layers) as LayerKey[]) layers[k] = a.layers.includes(k);
        store.set({ layers });
      }
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    busy = true;
    input.value = '';
    input.disabled = send.disabled = true;
    append('user', `<p>${escapeHtml(q)}</p>`);
    history.push({ role: 'user', content: q });
    const thinking = append('assistant', `<p class="ask__thinking"><span></span><span></span><span></span> Looking through the data…</p>`);
    try {
      const res = await callAgent<{ reply: string; actions: MapAction[]; truncated: boolean }>('/api/agents/ask', { messages: history.slice(-12) });
      thinking.innerHTML = renderMarkdown(res.reply) + (res.truncated ? `<p class="muted small">(Shortened: the question needed more lookups than allowed.)</p>` : '');
      history.push({ role: 'assistant', content: res.reply });
      applyActions(res.actions ?? []);
      // Phones have room for one sheet: show what the agent opened, keep the chat.
      const focused = (res.actions ?? []).some((x) => x.action.startsWith('focus_'));
      if (focused && window.matchMedia('(max-width: 899px)').matches) setOpen(false);
    } catch (err) {
      thinking.remove();
      history.pop(); // let the user retry the same question
      append('error', `<p>${escapeHtml(err instanceof AgentRequestError ? err.message : 'Something went wrong.')}</p>`);
      if (err instanceof AgentRequestError && err.status === 401) document.dispatchEvent(new CustomEvent('bri:open-login'));
    } finally {
      busy = false;
      input.disabled = send.disabled = false;
      input.focus();
      log.scrollTop = log.scrollHeight;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void ask(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  $('#ask-clear').addEventListener('click', () => {
    history.length = 0;
    void renderNotice();
  });
}
