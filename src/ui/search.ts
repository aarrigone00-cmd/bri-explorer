import { PROJECT_TYPES } from '../config';
import type { Store } from '../state/store';
import type { Dataset, Selection } from '../types';
import { $, escapeHtml } from './dom';

interface Entry {
  label: string;
  sub: string;
  haystack: string;
  selection: NonNullable<Selection>;
  kind: 'country' | 'project';
  type?: string;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function initSearch(data: Dataset, store: Store): void {
  const input = $('#search-input') as HTMLInputElement;
  const results = $('#search-results');

  const participants = new Map(data.participation.map((c) => [c.iso3, c]));
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const f of data.world.features) {
    const iso3 = f.properties.iso3;
    if (!iso3 || seen.has(iso3)) continue;
    seen.add(iso3);
    const p = participants.get(iso3);
    const label = p?.name ?? f.properties.name;
    entries.push({
      label,
      sub: p ? `Country · ${p.region}` : 'Country',
      haystack: normalize(`${label} ${f.properties.name} ${iso3}`),
      selection: { kind: 'country', iso3 },
      kind: 'country',
    });
  }
  for (const p of data.projects) {
    entries.push({
      label: p.name,
      sub: `${PROJECT_TYPES[p.type].label} · ${p.location}`,
      haystack: normalize(`${p.name} ${p.location} ${p.subtype} ${p.chineseEntities.join(' ')} ${p.localPartners.join(' ')}`),
      selection: { kind: 'project', id: p.id },
      kind: 'project',
      type: p.type,
    });
  }

  let matches: Entry[] = [];
  let active = -1;

  const close = () => {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const renderResults = () => {
    if (!matches.length) {
      results.innerHTML = `<li class="search__empty" role="option" aria-disabled="true">No matches</li>`;
    } else {
      results.innerHTML = matches
        .map(
          (m, i) => `<li id="sr-${i}" role="option" aria-selected="${i === active}" data-index="${i}" class="search__item${i === active ? ' is-active' : ''}">
            <span class="${m.kind === 'project' ? `dot dot--${m.type}` : 'dot dot--country'}"></span>
            <span class="search__text"><span class="search__label">${escapeHtml(m.label)}</span><span class="search__sub">${escapeHtml(m.sub)}</span></span></li>`,
        )
        .join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `sr-${active}`);
  };

  const choose = (m: Entry) => {
    input.value = m.label;
    close();
    input.blur();
    store.set({ selection: m.selection });
  };

  input.addEventListener('input', () => {
    const q = normalize(input.value.trim());
    if (!q) return close();
    const starts = entries.filter((e) => normalize(e.label).startsWith(q));
    const contains = entries.filter((e) => !starts.includes(e) && e.haystack.includes(q));
    matches = [...starts, ...contains].slice(0, 8);
    active = matches.length ? 0 : -1;
    renderResults();
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  results.addEventListener('mousedown', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!li) return;
    e.preventDefault();
    choose(matches[Number(li.dataset.index)]);
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}
