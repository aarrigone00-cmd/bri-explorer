import { AgentRequestError, callAgent } from '../agents/client';
import { getSupabase, isSupabaseConfigured } from '../auth/supabase';
import type { Store } from '../state/store';
import type { Dataset } from '../types';
import { $, escapeHtml, safeUrl } from './dom';

// Agent 4 UI: "China & the World" — the latest news digest, read straight from
// Supabase (published digests are public). Admins can start a fresh run.

interface DigestItem {
  headline: string;
  date: string;
  summary: string;
  why_it_matters: string;
  perspectives: string;
  topic: string;
  countries: string[];
  bri_related: boolean;
  sources: { url: string; title: string; publisher: string }[];
}
interface Digest {
  id: string;
  overview: string | null;
  items: DigestItem[];
  completed_at: string;
  search_count: number | null;
  model: string | null;
}

const fmtDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function initNews(data: Dataset, store: Store): void {
  const body = $('#news-body');
  if (!isSupabaseConfigured) {
    body.innerHTML = `<p class="muted">The news digest needs the site's database, which isn't configured.</p>`;
    return;
  }
  const countryName = new Map(data.participation.map((c) => [c.iso3, c.name]));
  for (const f of data.world.features) if (f.properties.iso3 && !countryName.has(f.properties.iso3)) countryName.set(f.properties.iso3, f.properties.name);
  let digest: Digest | null = null;
  let filter: 'all' | 'bri' = 'all';
  let adminNote = '';

  async function load() {
    try {
      const sb = await getSupabase();
      const { data: row, error } = await sb
        .from('news_digests')
        .select('id, overview, items, completed_at, search_count, model')
        .eq('status', 'ready')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      digest = row as Digest | null;
    } catch (err) {
      console.error(err);
      body.innerHTML = `<p class="muted">The news digest couldn't be loaded right now.</p>`;
      return;
    }
    render();
  }

  function render() {
    const admin = store.get().isAdmin;
    const adminBar = admin
      ? `<div class="news__admin"><button type="button" class="chip-button chip-button--small" data-news-run>Run the news agent now</button><span class="muted small">${escapeHtml(adminNote)}</span></div>`
      : '';
    if (!digest) {
      body.innerHTML = `${adminBar}<div class="card"><p>No digest has been published yet. The news agent runs once a day; the first digest will appear here after its first run.</p></div>`;
      return;
    }
    const items = digest.items.filter((i) => filter === 'all' || i.bri_related);
    body.innerHTML = `
      ${adminBar}
      <div class="news__meta">
        <p class="muted small">Updated ${escapeHtml(fmtDate(digest.completed_at))}${digest.search_count ? ` · ${digest.search_count} web searches` : ''} · ${digest.items.length} stories</p>
        <div class="news__filter" role="group" aria-label="Filter stories">
          <button type="button" class="chip-button chip-button--small${filter === 'all' ? ' is-on' : ''}" data-news-filter="all" aria-pressed="${filter === 'all'}">All stories</button>
          <button type="button" class="chip-button chip-button--small${filter === 'bri' ? ' is-on' : ''}" data-news-filter="bri" aria-pressed="${filter === 'bri'}">Belt and Road only</button>
        </div>
      </div>
      ${digest.overview ? `<p class="news__overview">${escapeHtml(digest.overview)}</p>` : ''}
      <div class="cards news__items">
        ${
          items.length
            ? items
                .map(
                  (it) => `<article class="card news-item">
            <div class="news-item__tags">
              <span class="badge">${escapeHtml(it.topic)}</span>
              ${it.bri_related ? '<span class="badge badge--bri">Belt and Road</span>' : ''}
              ${it.date ? `<span class="muted small">${escapeHtml(fmtDate(it.date))}</span>` : ''}
            </div>
            <h3>${escapeHtml(it.headline)}</h3>
            <p>${escapeHtml(it.summary)}</p>
            ${it.why_it_matters ? `<p class="small"><strong>Why it matters:</strong> ${escapeHtml(it.why_it_matters)}</p>` : ''}
            ${it.perspectives ? `<p class="small muted"><strong>Perspectives:</strong> ${escapeHtml(it.perspectives)}</p>` : ''}
            ${
              it.countries.length
                ? `<div class="news-item__countries">${it.countries
                    .map((c) => `<button type="button" class="ask__chip" data-news-country="${escapeHtml(c)}">${escapeHtml(countryName.get(c) ?? c)}</button>`)
                    .join('')}</div>`
                : ''
            }
            <p class="news-item__sources small">Sources: ${it.sources
              .map((s) => `<a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">${escapeHtml(s.publisher || s.title)}</a>`)
              .join(' · ')}</p>
          </article>`,
                )
                .join('')
            : '<p class="muted">No Belt and Road stories in this digest.</p>'
        }
      </div>
      <p class="card__note">Researched and written by an AI agent using web search. It is told to stay neutral and attribute claims, and every link was found in its search results. Check the sources before relying on a story.</p>`;
  }

  body.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest<HTMLElement>('[data-news-filter]');
    const c = t.closest<HTMLElement>('[data-news-country]');
    if (f) {
      filter = f.dataset.newsFilter as 'all' | 'bri';
      render();
    } else if (c) {
      store.set({ selection: { kind: 'country', iso3: c.dataset.newsCountry! } });
      document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' });
    } else if (t.closest('[data-news-run]')) {
      adminNote = 'Starting…';
      render();
      try {
        await callAgent('/api/agents/news/run');
        adminNote = 'Started. A new digest usually takes 2–5 minutes; refresh the page to see it.';
      } catch (err) {
        adminNote = err instanceof AgentRequestError ? err.message : 'Could not start the agent.';
      }
      render();
    }
  });

  store.subscribe((s, prev) => {
    if (s.isAdmin !== prev.isAdmin) render();
  });
  void load();
}
