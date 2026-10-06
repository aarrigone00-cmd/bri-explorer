import type { CostBasis, LayerKey, ProjectStatus, ProjectType } from './types';

export const BRI_LAUNCH_YEAR = 2013;

/** SVG glyphs (24×24 viewBox) used in markers, legend and filters. */
const glyphs: Record<ProjectType, string> = {
  rail: '<path d="M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-1 4v4h10V7H7Zm2 7.5a1 1 0 1 0 0 .01Zm6 0a1 1 0 1 0 0 .01ZM8 18l-2 3m10-3 2 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  port: '<path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v14m-7-7a7 7 0 0 0 14 0M8 10h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  road: '<path d="M9 3 5 21m10-18 4 18M12 4v3m0 4v3m0 4v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  energy: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  other: '<path d="M4 21V9l6-4v16m0-12 10 4v8M4 21h16M7 12h0m0 3h0m6 0h4m-4 3h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export const PROJECT_TYPES: Record<ProjectType, { label: string; plural: string; glyph: string }> = {
  rail: { label: 'Rail', plural: 'Railways & metros', glyph: glyphs.rail },
  port: { label: 'Port', plural: 'Ports', glyph: glyphs.port },
  road: { label: 'Road', plural: 'Roads, highways & bridges', glyph: glyphs.road },
  energy: { label: 'Energy', plural: 'Energy projects', glyph: glyphs.energy },
  other: { label: 'Other', plural: 'Industrial parks, urban & airports', glyph: glyphs.other },
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  operational: 'Operational',
  'partially-operational': 'Partially operational',
  'under-construction': 'Under construction',
  planned: 'Planned / agreed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
};

export const COST_BASIS_SHORT: Record<CostBasis, string> = {
  'total-cost': 'Total cost',
  financing: 'Loan / financing',
  acquisition: 'Acquisition / concession',
  contract: 'Contract value',
};

export interface LayerDef {
  key: LayerKey;
  label: string;
  group: 'Projects' | 'Routes & corridors' | 'Countries';
  swatch: 'marker' | 'land' | 'maritime' | 'corridor' | 'fill';
}

export const LAYERS: LayerDef[] = [
  { key: 'rail', label: 'Rail', group: 'Projects', swatch: 'marker' },
  { key: 'port', label: 'Ports', group: 'Projects', swatch: 'marker' },
  { key: 'road', label: 'Roads & bridges', group: 'Projects', swatch: 'marker' },
  { key: 'energy', label: 'Energy', group: 'Projects', swatch: 'marker' },
  { key: 'other', label: 'Other (parks, urban, airports)', group: 'Projects', swatch: 'marker' },
  { key: 'corridors', label: 'Economic corridors', group: 'Routes & corridors', swatch: 'corridor' },
  { key: 'land', label: 'Land routes (Silk Road Economic Belt)', group: 'Routes & corridors', swatch: 'land' },
  { key: 'maritime', label: 'Maritime routes (21st-Century MSR)', group: 'Routes & corridors', swatch: 'maritime' },
  { key: 'participants', label: 'Participating countries', group: 'Countries', swatch: 'fill' },
];

/**
 * Detailed basemap tiles (labels, coastlines, cities). CARTO basemaps need no
 * API key. Override with VITE_TILE_URL / VITE_TILE_ATTRIBUTION if desired.
 */
export const TILE_URL: string =
  import.meta.env.VITE_TILE_URL || 'https://{s}.basemaps.cartocdn.com/{theme}_only_labels/{z}/{x}/{y}{r}.png';
export const TILE_ATTRIBUTION: string =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
