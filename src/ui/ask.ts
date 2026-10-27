import { createAskEngine, type AskContext, type MapAction } from '../agents/ask-engine';
import type { Store } from '../state/store';
import type { Dataset } from '../types';
import { $, escapeHtml } from './dom';
import { renderMarkdown } from './markdown';

// Agent 1 UI: a chat panel over the map. Questions are answered in the browser
// by a rule-based engine over the site's data (no AI, no sign-in), and replies
// can move the map.

const SUGGESTIONS = [
  'Which countries received the most Chinese loans for railways?',
  'What is the China–Pakistan Economic Corridor?',
  'Tell me about Kenya',
  'How has BRI investment changed?',
];

export function initAsk(data: Dataset, store: Store): void {
  const panel = $('#ask-panel');
  const toggle = $('#ask-toggle');
  const log = $('#ask-log');
  const form = $('#ask-form') as HTMLFormElement;
  const input = $('#ask-input') as HTMLTextAreaElement;
  const engine = createAskEngine(data);
  let context: AskContext = { countries: [], projects: [] };
  let asked = 0;

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('has-ask', open);
    if (open) {
      // Share the left side of the map with the layers panel: close it.
      const filters = document.getElementById('filters-panel');
      if (filters && !filters.hidden) document.getElementById('filters-toggle')?.click();
      if (!asked) renderWelcome();
      input.focus();
    }
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden !== false));
  // Opening the layers panel closes this one (they share the same space).
  document.getElementById('filters-toggle')?.addEventListener('click', () => {
    if (!panel.hidden && document.getElementById('filters-panel')?.hidden === false) setOpen(false);
  });
  $('#ask-close').addEventListener('click', () => setOpen(false));

  function renderWelcome() {
    log.innerHTML = `
      <div class="ask__welcome">
        <p>Ask about a country, project, corridor, region, sector or year. Answers come straight from the site's data and sources, and I can move the map to show you.</p>
        <div class="ask__chips">${SUGGESTIONS.map((q) => `<button type="button" class="ask__chip" data-suggest="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
      </div>`;
  }
  log.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-suggest]');
    if (chip) ask(chip.dataset.suggest!);
  });

  function append(role: 'user' | 'assistant', html: string): HTMLElement {
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
      else if (a.action === 'add_layers') {
        const layers = { ...store.get().layers };
        for (const k of a.layers) layers[k] = true;
        store.set({ layers });
      }
    }
  }

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    input.value = '';
    asked += 1;
    const asking = append('user', `<p>${escapeHtml(q)}</p>`);
    const res = engine.answer(q, context);
    context = res.context;
    append('assistant', renderMarkdown(res.reply));
    // Show the start of the answer, not its end.
    log.scrollTop += asking.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
    applyActions(res.actions);
    // Phones have room for one sheet: show what the answer opened, keep the chat.
    const focused = res.actions.some((x) => x.action.startsWith('focus_'));
    if (focused && window.matchMedia('(max-width: 899px)').matches) setOpen(false);
    else input.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  $('#ask-clear').addEventListener('click', () => {
    asked = 0;
    context = { countries: [], projects: [] };
    renderWelcome();
  });
}
