import L from 'leaflet';
import { PROJECT_TYPES, STATUS_LABELS, TILE_ATTRIBUTION, TILE_URL } from '../config';
import { participationAt, projectStatusAt, projectVisibleAt } from '../lib/analytics';
import type { AppState, Store } from '../state/store';
import type { Dataset, LatLng, Project } from '../types';
import { escapeHtml } from '../ui/dom';

export interface MapController {
  focusCountry(iso3: string): void;
  focusProject(id: string): void;
  invalidateSize(): void;
}

const PANES = {
  countries: 400,
  labels: 405,
  corridors: 410,
  routes: 420,
  projectLines: 430,
} as const;

export function createMap(el: HTMLElement, data: Dataset, store: Store): MapController {
  const map = L.map(el, {
    center: [28, 70],
    zoom: 3,
    minZoom: 1.5,
    zoomSnap: 0.25,
    maxZoom: 10,
    worldCopyJump: false,
    maxBounds: [[-75, -220], [85, 240]],
    maxBoundsViscosity: 0.8,
    zoomControl: false,
    attributionControl: true,
  });
  // Initial view: Europe, Africa and Asia, where most BRI activity is concentrated.
  if (el.clientWidth < 600) map.setView([24, 70], 2, { animate: false });
  else map.fitBounds([[-12, -12], [58, 135]], { animate: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.attributionControl.addAttribution('Boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');

  for (const [name, z] of Object.entries(PANES)) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(z);
  }
  map.getPane('labels')!.style.pointerEvents = 'none';

  const participationByIso = new Map(data.participation.map((c) => [c.iso3, c]));

  // ---- Country polygons -------------------------------------------------------
  const countryLayers = new Map<string, L.Path[]>();
  L.geoJSON(data.world, {
    pane: 'countries',
    style: () => ({ className: 'country', weight: 0.6 }),
    onEachFeature: (f, layer) => {
      const iso3 = f.properties.iso3;
      if (!iso3) {
        (layer as L.Path).options.interactive = false;
        return;
      }
      const list = countryLayers.get(iso3) ?? [];
      list.push(layer as L.Path);
      countryLayers.set(iso3, list);
      const name = participationByIso.get(iso3)?.name ?? f.properties.name;
      layer.bindTooltip(escapeHtml(name), { sticky: true, className: 'map-tooltip', direction: 'top', offset: [0, -6] });
      layer.on('click', () => store.set({ selection: { kind: 'country', iso3 } }));
    },
  }).addTo(map);

  function styleCountries(state: AppState) {
    for (const [iso3, layers] of countryLayers) {
      const status = state.layers.participants ? participationAt(participationByIso.get(iso3), state.year) : 'none';
      const selected = state.selection?.kind === 'country' && state.selection.iso3 === iso3;
      for (const l of layers) {
        const pathEl = (l as unknown as { _path?: SVGPathElement })._path;
        if (!pathEl) continue;
        pathEl.setAttribute(
          'class',
          `leaflet-interactive country country--${status}${iso3 === 'CHN' ? ' country--china' : ''}${selected ? ' is-selected' : ''}`,
        );
      }
    }
  }

  // ---- Detailed labels (optional tiles) --------------------------------------
  let labels: L.TileLayer | null = null;
  function updateLabels(state: AppState) {
    labels?.remove();
    labels = null;
    if (!state.showLabels) return;
    const url = TILE_URL.replace('{theme}', state.resolvedTheme === 'dark' ? 'dark' : 'light');
    labels = L.tileLayer(url, {
      pane: 'labels',
      subdomains: 'abcd',
      attribution: TILE_ATTRIBUTION,
      maxZoom: 19,
      opacity: 0.9,
    }).addTo(map);
  }

  // ---- Corridors ---------------------------------------------------------------
  const corridorGroup = L.layerGroup();
  for (const c of data.corridors) {
    const line = L.polyline(c.paths as LatLng[][], {
      pane: 'corridors',
      className: 'corridor',
      weight: 12,
      lineCap: 'round',
      lineJoin: 'round',
    });
    line.bindTooltip(escapeHtml(c.name), { sticky: true, className: 'map-tooltip' });
    line.bindPopup(
      `<div class="popup"><div class="popup__kicker">Economic corridor · schematic</div><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.description)}</p></div>`,
      { maxWidth: 300 },
    );
    corridorGroup.addLayer(line);
  }

  // ---- Land & maritime routes -------------------------------------------------
  const routeGroups = { land: L.layerGroup(), maritime: L.layerGroup() };
  for (const r of data.routes) {
    const lines = [r.path, ...(r.branches ?? [])];
    const group = routeGroups[r.kind];
    const glow = L.polyline(lines, { pane: 'routes', className: `route-glow route-glow--${r.kind}`, weight: 8, interactive: false });
    const core = L.polyline(lines, { pane: 'routes', className: `route route--${r.kind}`, weight: r.kind === 'land' ? 2.5 : 2 });
    core.bindTooltip(escapeHtml(r.name), { sticky: true, className: 'map-tooltip' });
    core.bindPopup(
      `<div class="popup"><div class="popup__kicker">${r.kind === 'land' ? 'Land route' : 'Maritime route'} · schematic</div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.description)}</p><p class="popup__note">Based on the directions described in the 2015 “Vision and Actions” document.</p></div>`,
      { maxWidth: 300 },
    );
    group.addLayer(glow).addLayer(core);
  }

  // ---- Projects -----------------------------------------------------------------
  const projectLayers = new Map<string, { marker: L.Marker; line?: L.Polyline }>();
  const projectGroup = L.layerGroup().addTo(map);
  for (const p of data.projects) {
    const marker = L.marker(p.coordinates, {
      icon: projectIcon(p, p.status, false),
      riseOnHover: true,
      keyboard: true,
      title: p.name,
      alt: `${PROJECT_TYPES[p.type].label} project: ${p.name}`,
    });
    marker.bindTooltip(
      `<strong>${escapeHtml(p.name)}</strong><br><span>${escapeHtml(PROJECT_TYPES[p.type].label)} · ${escapeHtml(STATUS_LABELS[p.status])}</span>`,
      { direction: 'top', offset: [0, -14], className: 'map-tooltip' },
    );
    marker.on('click', () => store.set({ selection: { kind: 'project', id: p.id } }));
    let line: L.Polyline | undefined;
    if (p.path) {
      line = L.polyline(p.path, { pane: 'projectLines', className: `project-line project-line--${p.type}`, weight: 3.5 });
      line.on('click', () => store.set({ selection: { kind: 'project', id: p.id } }));
    }
    projectLayers.set(p.id, { marker, line });
  }

  function updateProjects(state: AppState) {
    for (const p of data.projects) {
      const entry = projectLayers.get(p.id)!;
      const visible = state.layers[p.type] && projectVisibleAt(p, state.year);
      const selected = state.selection?.kind === 'project' && state.selection.id === p.id;
      if (visible) {
        entry.marker.setIcon(projectIcon(p, projectStatusAt(p, state.year), selected));
        entry.marker.setZIndexOffset(selected ? 1000 : 0);
        if (!projectGroup.hasLayer(entry.marker)) projectGroup.addLayer(entry.marker);
        if (entry.line && !projectGroup.hasLayer(entry.line)) projectGroup.addLayer(entry.line);
      } else {
        projectGroup.removeLayer(entry.marker);
        if (entry.line) projectGroup.removeLayer(entry.line);
      }
    }
  }

  const toggle = (layer: L.Layer, on: boolean) => {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) layer.remove();
  };

  function render(state: AppState, prev?: AppState) {
    toggle(corridorGroup, state.layers.corridors);
    toggle(routeGroups.land, state.layers.land);
    toggle(routeGroups.maritime, state.layers.maritime);
    styleCountries(state);
    updateProjects(state);
    if (!prev || prev.showLabels !== state.showLabels || prev.resolvedTheme !== state.resolvedTheme) updateLabels(state);
  }

  render(store.get());
  store.subscribe((s, prev) => render(s, prev));

  const isWide = () => window.matchMedia('(min-width: 900px)').matches;
  // Keep the focused feature clear of the detail panel (side panel on wide
  // screens, bottom sheet covering ~62% of the map on narrow ones).
  const panelPadding = (): L.PointExpression => (isWide() ? [420, 40] : [30, el.clientHeight * 0.62 + 20]);
  const panelOffset = (): L.PointExpression => (isWide() ? [190, 0] : [0, el.clientHeight * 0.31]);

  return {
    focusCountry(iso3) {
      const layers = countryLayers.get(iso3);
      if (!layers?.length) return;
      // Fit the largest polygon so far-flung territories don't zoom the map out.
      const bounds = L.featureGroup(layers).getBounds();
      const biggest = largestPolygonBounds(layers) ?? bounds;
      map.flyToBounds(biggest, { paddingBottomRight: panelPadding(), paddingTopLeft: [40, 80], maxZoom: 6, duration: 0.9 });
    },
    focusProject(id) {
      const p = data.projects.find((x) => x.id === id);
      if (!p) return;
      const e = projectLayers.get(id);
      if (e?.line) {
        map.flyToBounds(e.line.getBounds(), { paddingBottomRight: panelPadding(), paddingTopLeft: [40, 80], maxZoom: 8, duration: 0.9 });
      } else {
        const z = Math.max(map.getZoom(), 6);
        const target = map.unproject(map.project(p.coordinates, z).add(panelOffset()), z);
        map.flyTo(target, z, { duration: 0.9 });
      }
    },
    invalidateSize() {
      map.invalidateSize();
    },
  };
}

function largestPolygonBounds(layers: L.Path[]): L.LatLngBounds | null {
  let best: L.LatLngBounds | null = null;
  let bestArea = -1;
  for (const layer of layers) {
    const latlngs = (layer as L.Polygon).getLatLngs() as unknown;
    // Polygon → LatLng[][]; MultiPolygon → LatLng[][][]
    const polys: L.LatLng[][] = Array.isArray((latlngs as L.LatLng[][][])[0]?.[0])
      ? (latlngs as L.LatLng[][][]).map((p) => p[0])
      : [(latlngs as L.LatLng[][])[0]];
    for (const ring of polys) {
      const b = L.latLngBounds(ring);
      const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
      if (area > bestArea) {
        bestArea = area;
        best = b;
      }
    }
  }
  return best;
}

function projectIcon(p: Project, status: string, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'pm-wrap',
    html: `<div class="pm pm--${p.type} pm--${status}${selected ? ' is-selected' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${PROJECT_TYPES[p.type].glyph}</svg></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}
