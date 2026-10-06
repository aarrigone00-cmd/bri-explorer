// Shared data model. The JSON files in public/data/ follow these shapes; see
// README.md ("Adding data") for how to extend them.

export type LatLng = [number, number];

export type ProjectType = 'rail' | 'port' | 'road' | 'energy' | 'other';

export type ProjectStatus =
  | 'operational'
  | 'completed'
  | 'partially-operational'
  | 'under-construction'
  | 'planned'
  | 'suspended'
  | 'cancelled';

export type CostBasis = 'total-cost' | 'financing' | 'acquisition' | 'contract';

export interface ProjectCost {
  /** Human-readable figure exactly as it should be displayed, with qualifiers. */
  display: string;
  /** A single widely reported USD figure in millions, or null if none is used. */
  amountUsdMillions: number | null;
  basis: CostBasis;
}

export interface Reference {
  label: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  subtype: string;
  countries: string[]; // ISO 3166-1 alpha-3
  location: string;
  coordinates: LatLng;
  /** Optional approximate alignment for linear projects. */
  path?: LatLng[];
  status: ProjectStatus;
  statusNote?: string;
  startYear: number | null;
  completionYear: number | null;
  cost: ProjectCost;
  chineseEntities: string[];
  localPartners: string[];
  corridors: string[];
  description: string;
  references: Reference[];
  sourceIds: string[];
}

export interface ParticipationCountry {
  iso3: string;
  name: string;
  region: string;
  incomeGroup: string;
  mouDate: string | null;
  exitDate: string | null;
  labelPoint: LatLng | null;
}

export interface Corridor {
  id: string;
  name: string;
  countries: string[];
  description: string;
  paths: LatLng[][];
}

export interface Route {
  id: string;
  kind: 'land' | 'maritime';
  name: string;
  description: string;
  path: LatLng[];
  branches?: LatLng[][];
}

export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: string;
  usedFor: string;
  license?: string;
}

/**
 * One Chinese official-sector financial commitment (loan or grant) from
 * AidData's GCDF v3. Several records can relate to the same physical project.
 */
export interface FinanceRecord {
  id: number; // AidData Record ID
  title: string; // AidData's record title, verbatim
  iso3: string;
  sector: string; // AidData sector name
  type: ProjectType;
  subtype: string;
  status: 'completed' | 'under-construction' | 'planned';
  amountUsd2021: number | null; // commitment, constant 2021 USD
  commitmentYear: number | null;
  startYear: number | null;
  completionYear: number | null;
  lender: string | null; // parsed from the record title
  precise: boolean; // all OSM features precisely located
  osm: string | null; // first OpenStreetMap feature link
  coordinates: LatLng;
  shapes?: LatLng[][]; // simplified outlines of long (linear) features
  paths?: LatLng[][];
}

export interface Engagement {
  meta: { note: string; unit: string; sourceIds: string[] };
  periods: { period: string; construction: number; investment: number; total: number; deals: string; change: string; sourceId: string }[];
  cumulative: { asOf: string; total: number; construction: number; investment: number; sourceId: string }[];
  highlights2025: { label: string; value: number; note: string }[];
  countries2025: { measure: string; sourceId: string; values: Record<string, number> };
  official: { label: string; items: { label: string; value: number; note: string }[]; sourceId: string; note: string };
}

export interface Dataset {
  projects: Project[];
  projectsMeta: { asOf: string; description: string; costBasisLabels: Record<CostBasis, string> };
  participation: ParticipationCountry[];
  participationNote: string;
  corridors: Corridor[];
  corridorsNote: string;
  routes: Route[];
  routesNote: string;
  sources: Source[];
  records: FinanceRecord[];
  recordsNote: string;
  engagement: Engagement;
  /** GeoJSON features for country boundaries, keyed by ISO3 where known. */
  world: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { name: string; iso3: string | null }>;
}

/** Map layers that can be toggled from the filter panel. */
export type LayerKey = ProjectType | 'aiddata' | 'corridors' | 'land' | 'maritime' | 'participants';

export type Selection =
  | { kind: 'country'; iso3: string }
  | { kind: 'project'; id: string }
  | { kind: 'record'; id: number }
  | null;

export type ThemePreference = 'light' | 'dark' | 'system';
