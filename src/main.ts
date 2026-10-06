import 'leaflet/dist/leaflet.css';
import './styles/main.css';
import { loadDataset } from './data/loader';
import { yearRange } from './lib/analytics';
import { createMap } from './map/map';
import { Store } from './state/store';
import { initDashboard } from './ui/dashboard';
import { initDetailPanel } from './ui/detail';
import { $ } from './ui/dom';
import { initFilters } from './ui/filters';
import { initLegend } from './ui/legend';
import { initSearch } from './ui/search';
import { initSources } from './ui/sources';
import { initTimeline } from './ui/timeline';
import { initTheme, readThemePreference, resolveTheme } from './ui/theme';

async function main() {
  const status = $('#map-status');
  const theme = readThemePreference();
  const store = new Store({
    layers: {
      rail: true,
      port: true,
      road: true,
      energy: true,
      other: true,
      corridors: true,
      land: true,
      maritime: true,
      participants: true,
    },
    year: 2013,
    selection: null,
    theme,
    resolvedTheme: resolveTheme(theme),
    showLabels: true,
  });
  initTheme(store);

  let data;
  try {
    data = await loadDataset();
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not load map data. Please refresh the page.';
    status.classList.add('is-error');
    return;
  }

  const range = yearRange(data);
  store.set({ year: range.max });

  const map = createMap($('#map'), data, store);
  initFilters(data, store);
  initLegend(store);
  initTimeline(store, range);
  initSearch(data, store);
  initDetailPanel(data, store);
  initDashboard(data, store);
  initSources(data);

  // Fly to whatever gets selected (from the map, search or the detail panel).
  store.subscribe((s, prev) => {
    if (!s.selection || s.selection === prev.selection) return;
    if (s.selection.kind === 'country') map.focusCountry(s.selection.iso3);
    else map.focusProject(s.selection.id);
  });

  window.addEventListener('resize', () => map.invalidateSize());
  status.remove();

  // Exposed for debugging and for future feature modules / tests.
  (window as unknown as { bri: unknown }).bri = { store, data };
}

main();
