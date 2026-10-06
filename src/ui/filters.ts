import { LAYERS, PROJECT_TYPES } from '../config';
import type { Store } from '../state/store';
import type { Dataset, ProjectType } from '../types';
import { $, escapeHtml } from './dom';

export function initFilters(data: Dataset, store: Store): void {
  const panel = $('#filters-panel');
  const body = $('#filters-body');
  const toggleBtn = $('#filters-toggle');
  const labelsToggle = $('#labels-toggle') as HTMLInputElement;

  const counts = new Map<string, number>();
  for (const p of data.projects) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  counts.set('corridors', data.corridors.length);
  counts.set('land', data.routes.filter((r) => r.kind === 'land').length);
  counts.set('maritime', data.routes.filter((r) => r.kind === 'maritime').length);

  const groups = [...new Set(LAYERS.map((l) => l.group))];
  body.innerHTML = groups
    .map(
      (g) => `<fieldset class="filters__group"><legend>${g}</legend>${LAYERS.filter((l) => l.group === g)
        .map((l) => {
          const swatch =
            l.swatch === 'marker'
              ? `<span class="pm pm--${l.key} pm--mini"><svg viewBox="0 0 24 24" aria-hidden="true">${PROJECT_TYPES[l.key as ProjectType].glyph}</svg></span>`
              : `<span class="swatch swatch--${l.swatch}"></span>`;
          const n = counts.get(l.key);
          return `<label class="toggle"><input type="checkbox" data-layer="${l.key}" />${swatch}<span>${escapeHtml(l.label)}</span>${n !== undefined ? `<span class="toggle__count">${n}</span>` : ''}</label>`;
        })
        .join('')}</fieldset>`,
    )
    .join('');

  const sync = () => {
    const s = store.get();
    body.querySelectorAll<HTMLInputElement>('input[data-layer]').forEach((i) => {
      i.checked = s.layers[i.dataset.layer as keyof typeof s.layers];
    });
    labelsToggle.checked = s.showLabels;
  };
  sync();
  store.subscribe((s, prev) => {
    if (s.layers !== prev.layers || s.showLabels !== prev.showLabels) sync();
  });

  body.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.layer;
    if (!key) return;
    store.set({ layers: { ...store.get().layers, [key]: input.checked } });
  });
  labelsToggle.addEventListener('change', () => store.set({ showLabels: labelsToggle.checked }));

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
  };
  toggleBtn.addEventListener('click', () => setOpen(panel.hidden !== false));
  panel.querySelector('[data-close-filters]')!.addEventListener('click', () => setOpen(false));
  // Open by default on wide screens only.
  setOpen(window.matchMedia('(min-width: 1100px)').matches);
}
