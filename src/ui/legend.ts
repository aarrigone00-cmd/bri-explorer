import { PROJECT_TYPES } from '../config';
import type { Store } from '../state/store';
import type { ProjectType } from '../types';
import { $ } from './dom';

export function initLegend(store: Store): void {
  const el = $('#legend');
  const render = () => {
    const { layers } = store.get();
    const items: string[] = [];
    if (layers.participants) {
      items.push('<span class="legend__item"><span class="swatch swatch--fill"></span>Participant</span>');
      items.push('<span class="legend__item"><span class="swatch swatch--exited"></span>Exited</span>');
      items.push('<span class="legend__item"><span class="swatch swatch--unconfirmed"></span>Unconfirmed</span>');
    }
    if (layers.land) items.push('<span class="legend__item"><span class="swatch swatch--land"></span>Land route</span>');
    if (layers.maritime) items.push('<span class="legend__item"><span class="swatch swatch--maritime"></span>Maritime route</span>');
    if (layers.corridors) items.push('<span class="legend__item"><span class="swatch swatch--corridor"></span>Corridor</span>');
    for (const t of Object.keys(PROJECT_TYPES) as ProjectType[]) {
      if (layers[t]) {
        items.push(
          `<span class="legend__item"><span class="pm pm--${t} pm--mini"><svg viewBox="0 0 24 24" aria-hidden="true">${PROJECT_TYPES[t].glyph}</svg></span>${PROJECT_TYPES[t].label}</span>`,
        );
      }
    }
    items.push('<span class="legend__item"><span class="pm pm--other pm--under-construction pm--mini pm--blank"></span>Hollow = not yet complete</span>');
    el.innerHTML = items.join('');
  };
  render();
  store.subscribe((s, prev) => {
    if (s.layers !== prev.layers) render();
  });
}
