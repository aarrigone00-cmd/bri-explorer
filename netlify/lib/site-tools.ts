import type Anthropic from '@anthropic-ai/sdk';
import { TYPE_PLURALS } from '../../src/labels';
import type { FinanceRecord, ProjectType } from '../../src/types';
import {
  corridors,
  countryByIso,
  countryName,
  countryRegion,
  engagement,
  norm,
  participation,
  projectById,
  projects,
  projectsAsOf,
  recordById,
  recordShortTitle,
  records,
} from './data';

// Tools that read the BRI Explorer datasets. Shared by the "Ask the Map" and
// "My Briefing" agents. Results are compact JSON so the model can cite them.

/** A map change the browser applies after the agent replies. */
export type MapAction =
  | { action: 'focus_country'; iso3: string }
  | { action: 'focus_project'; id: string }
  | { action: 'focus_record'; id: number }
  | { action: 'set_year'; year: number }
  | { action: 'show_layers'; layers: string[] };

const TYPES = ['rail', 'port', 'road', 'energy', 'other'] as const;
const LAYER_KEYS = [...TYPES, 'aiddata', 'corridors', 'land', 'maritime', 'participants'];

const round1 = (n: number) => Math.round(n * 10) / 10;
const usdBn = (v: number) => round1(v / 1e9);

const yearOf = (iso: string | null) => (iso ? Number(iso.slice(0, 4)) : null);

function briStatus(iso3: string): string {
  const c = countryByIso.get(iso3);
  if (!c) return 'Not on the GFDC list of BRI MoU signatories';
  if (c.exitDate) return `Exited the BRI (${c.exitDate})`;
  if (!c.mouDate) return 'Listed by GFDC, MoU date not independently confirmed';
  return `BRI participant, likely MoU ${c.mouDate}`;
}

function recordSummary(r: FinanceRecord) {
  return {
    id: r.id,
    project: recordShortTitle(r),
    country: countryName(r.iso3),
    iso3: r.iso3,
    type: r.type,
    subtype: r.subtype,
    commitment_year: r.commitmentYear,
    amount_usd_bn_2021: r.amountUsd2021 === null ? null : Math.round(r.amountUsd2021 / 1e7) / 100,
    lender: r.lender,
    status: r.status,
  };
}

// ---- Tool definitions -----------------------------------------------------------

export const DATA_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_site',
    description:
      'Search BRI Explorer for countries, flagship projects and AidData finance records by name or keyword (e.g. "Kenya", "railway", "Gwadar", "China Eximbank"). Returns ids to use with the other tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_country',
    description:
      "Everything BRI Explorer has on one country: BRI membership (GFDC list), region, economic corridors, flagship projects, a summary of AidData finance records, and 2025 engagement if reported.",
    input_schema: {
      type: 'object',
      properties: { iso3: { type: 'string', description: 'ISO 3166-1 alpha-3 code, e.g. KEN.' } },
      required: ['iso3'],
    },
  },
  {
    name: 'get_project',
    description: 'Full details of one curated flagship project (cost as reported, dates, status, Chinese and local partners, references).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Flagship project id from search_site.' } },
      required: ['id'],
    },
  },
  {
    name: 'query_aiddata',
    description:
      'Filter and aggregate the 1,297 AidData finance records (Chinese official loan/grant commitments for infrastructure, 2013–2021, constant 2021 USD). Use group_by to rank countries, regions, sectors, years or lenders.',
    input_schema: {
      type: 'object',
      properties: {
        iso3: { type: 'string', description: 'Only this recipient country.' },
        region: { type: 'string', description: 'Only this World Bank region, e.g. "Sub-Saharan Africa", "South Asia".' },
        type: { type: 'string', enum: [...TYPES], description: 'Only this sector type.' },
        lender: { type: 'string', description: 'Only records whose lender name contains this text, e.g. "Eximbank".' },
        year_from: { type: 'integer', description: 'Commitment year from (inclusive).' },
        year_to: { type: 'integer', description: 'Commitment year to (inclusive).' },
        group_by: { type: 'string', enum: ['none', 'country', 'region', 'type', 'year', 'lender'] },
        limit: { type: 'integer', description: 'Max groups / records to return (default 10, max 25).' },
      },
      required: [],
    },
  },
  {
    name: 'get_overview',
    description:
      'Headline numbers: BRI participants by region, flagship project counts, AidData totals, latest 2025/2026 engagement figures, the six economic corridors, and what each data source covers.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

export const MAP_TOOL: Anthropic.Beta.BetaTool = {
  name: 'update_map',
  description:
    "Change what the user sees on the BRI Explorer map next to your answer: zoom to a country, flagship project or AidData record, move the timeline, or choose which layers are visible. Call it when showing something on the map would help; at most a few times per answer.",
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['focus_country', 'focus_project', 'focus_record', 'set_year', 'show_layers'] },
      iso3: { type: 'string', description: 'For focus_country.' },
      project_id: { type: 'string', description: 'For focus_project.' },
      record_id: { type: 'integer', description: 'For focus_record.' },
      year: { type: 'integer', description: 'For set_year (2013–2026).' },
      layers: { type: 'array', items: { type: 'string', enum: LAYER_KEYS }, description: 'For show_layers: the layers to switch on (others are switched off).' },
    },
    required: ['action'],
  },
};

// ---- Tool implementations -------------------------------------------------------

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);

function searchSite(input: Input) {
  const q = norm(str(input.query));
  if (!q) return { error: 'query is required' };
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => norm(text).includes(w));
  const countries = participation.filter((c) => hit(`${c.name} ${c.iso3}`)).slice(0, 5);
  const flagship = projects.filter((p) => hit(`${p.name} ${p.location} ${p.subtype} ${p.chineseEntities.join(' ')} ${p.localPartners.join(' ')}`)).slice(0, 8);
  const recs = records.filter((r) => hit(`${r.title} ${countryName(r.iso3)} ${r.lender ?? ''}`)).slice(0, 8);
  return {
    countries: countries.map((c) => ({ iso3: c.iso3, name: c.name })),
    flagship_projects: flagship.map((p) => ({ id: p.id, name: p.name, type: p.type, countries: p.countries.map(countryName) })),
    aiddata_records: recs.map(recordSummary),
    note: flagship.length + recs.length + countries.length === 0 ? 'No matches. Try fewer or different words.' : undefined,
  };
}

function getCountry(input: Input) {
  const iso3 = str(input.iso3).toUpperCase();
  const known = countryByIso.has(iso3) || records.some((r) => r.iso3 === iso3);
  if (!known) return { error: `No data for "${iso3}". Use search_site to find the ISO3 code.` };
  const c = countryByIso.get(iso3);
  const recs = records.filter((r) => r.iso3 === iso3);
  const withAmt = recs.filter((r) => r.amountUsd2021 !== null);
  const byType: Record<string, number> = {};
  for (const r of recs) byType[r.type] = (byType[r.type] ?? 0) + 1;
  const largest = [...withAmt].sort((a, b) => b.amountUsd2021! - a.amountUsd2021!).slice(0, 6);
  const eng = engagement.countries2025.values[iso3];
  return {
    iso3,
    name: countryName(iso3),
    region: c?.region ?? null,
    income_group: c?.incomeGroup ?? null,
    bri_status: briStatus(iso3),
    economic_corridors: corridors.filter((k) => k.countries.includes(iso3)).map((k) => k.name),
    flagship_projects: projects
      .filter((p) => p.countries.includes(iso3))
      .map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, start: p.startYear, completion: p.completionYear, reported_cost: p.cost.display })),
    aiddata_2013_2021: {
      records: recs.length,
      with_amount: withAmt.length,
      total_committed_usd_bn_2021: usdBn(withAmt.reduce((s, r) => s + r.amountUsd2021!, 0)),
      records_by_type: byType,
      largest: largest.map(recordSummary),
    },
    engagement_2025: eng === undefined ? null : { measure: engagement.countries2025.measure, usd_bn: eng, source: 'Nedopil (2026) BRI Investment Report 2025, preliminary' },
  };
}

function getProject(input: Input) {
  const p = projectById.get(str(input.id));
  if (!p) return { error: 'Unknown project id. Use search_site first.' };
  const { path: _path, coordinates: _coords, ...rest } = p;
  return { ...rest, countries: p.countries.map((i) => ({ iso3: i, name: countryName(i) })), data_as_of: projectsAsOf };
}

function queryAidData(input: Input) {
  const iso3 = str(input.iso3).toUpperCase();
  const region = norm(str(input.region));
  const type = str(input.type) as ProjectType;
  const lender = norm(str(input.lender));
  const from = int(input.year_from);
  const to = int(input.year_to);
  const groupBy = str(input.group_by) || 'none';
  const limit = Math.min(Math.max(int(input.limit) ?? 10, 1), 25);

  const matched = records.filter(
    (r) =>
      (!iso3 || r.iso3 === iso3) &&
      (!region || norm(countryRegion(r.iso3)).includes(region)) &&
      (!type || r.type === type) &&
      (!lender || norm(r.lender ?? '').includes(lender)) &&
      (from === null || (r.commitmentYear ?? 0) >= from) &&
      (to === null || (r.commitmentYear ?? 9999) <= to),
  );
  const withAmt = matched.filter((r) => r.amountUsd2021 !== null);
  const out: Record<string, unknown> = {
    matched_records: matched.length,
    records_with_amount: withAmt.length,
    total_committed_usd_bn_2021: usdBn(withAmt.reduce((s, r) => s + r.amountUsd2021!, 0)),
  };
  if (groupBy !== 'none') {
    const key = (r: FinanceRecord): string => {
      switch (groupBy) {
        case 'country':
          return countryName(r.iso3);
        case 'region':
          return countryRegion(r.iso3);
        case 'type':
          return TYPE_PLURALS[r.type];
        case 'year':
          return String(r.commitmentYear ?? 'unknown');
        default:
          return r.lender ?? 'Not stated in record title';
      }
    };
    const groups = new Map<string, { records: number; usd: number }>();
    for (const r of matched) {
      const g = groups.get(key(r)) ?? { records: 0, usd: 0 };
      g.records += 1;
      g.usd += r.amountUsd2021 ?? 0;
      groups.set(key(r), g);
    }
    out.groups = [...groups.entries()]
      .map(([k, g]) => ({ group: k, records: g.records, committed_usd_bn_2021: usdBn(g.usd) }))
      .sort((a, b) => (groupBy === 'year' ? a.group.localeCompare(b.group) : b.committed_usd_bn_2021 - a.committed_usd_bn_2021))
      .slice(0, groupBy === 'year' ? 30 : limit);
  }
  out.largest_records = [...withAmt].sort((a, b) => b.amountUsd2021! - a.amountUsd2021!).slice(0, Math.min(limit, 10)).map(recordSummary);
  out.note = 'AidData amounts are commitments (not disbursements) in constant 2021 USD; several records can belong to one project.';
  return out;
}

function getOverview() {
  const byRegion: Record<string, number> = {};
  let participants = 0;
  for (const c of participation) {
    if (c.mouDate && !c.exitDate) {
      participants += 1;
      byRegion[c.region] = (byRegion[c.region] ?? 0) + 1;
    }
  }
  const withAmt = records.filter((r) => r.amountUsd2021 !== null);
  return {
    bri_participants: {
      count_with_dated_mou_incl_china: participants,
      by_region: byRegion,
      exited: participation.filter((c) => c.exitDate).map((c) => `${c.name} (${yearOf(c.exitDate)})`),
      source: 'Nedopil (2025), GFDC Fudan University, May 2025 list',
    },
    flagship_projects: { count: projects.length, note: 'Curated sample of widely reported projects, not an inventory', as_of: projectsAsOf },
    aiddata: {
      records: records.length,
      countries: new Set(records.map((r) => r.iso3)).size,
      total_committed_usd_bn_2021: usdBn(withAmt.reduce((s, r) => s + r.amountUsd2021!, 0)),
      coverage: 'Geolocated infrastructure commitments 2013–2021 from AidData GCDF v3 (a subset of AidData’s full dataset)',
    },
    latest_engagement: {
      periods: engagement.periods,
      cumulative: engagement.cumulative,
      highlights_2025: engagement.highlights2025,
      note: engagement.meta.note,
    },
    economic_corridors: corridors.map((k) => ({ id: k.id, name: k.name, countries: k.countries.map(countryName) })),
  };
}

/** Validates an update_map call and converts it to a browser action. */
export function toMapAction(input: Input): MapAction | { error: string } {
  switch (str(input.action)) {
    case 'focus_country': {
      const iso3 = str(input.iso3).toUpperCase();
      return countryByIso.has(iso3) || records.some((r) => r.iso3 === iso3) ? { action: 'focus_country', iso3 } : { error: 'Unknown iso3' };
    }
    case 'focus_project': {
      const id = str(input.project_id);
      return projectById.has(id) ? { action: 'focus_project', id } : { error: 'Unknown project_id' };
    }
    case 'focus_record': {
      const id = int(input.record_id);
      return id !== null && recordById.has(id) ? { action: 'focus_record', id } : { error: 'Unknown record_id' };
    }
    case 'set_year': {
      const year = int(input.year);
      return year !== null && year >= 2013 && year <= 2026 ? { action: 'set_year', year } : { error: 'year must be 2013–2026' };
    }
    case 'show_layers': {
      const layers = Array.isArray(input.layers) ? input.layers.filter((l): l is string => typeof l === 'string' && LAYER_KEYS.includes(l)) : [];
      return layers.length ? { action: 'show_layers', layers } : { error: 'layers must list at least one valid layer' };
    }
    default:
      return { error: 'Unknown action' };
  }
}

export function runDataTool(name: string, input: Input): unknown {
  switch (name) {
    case 'search_site':
      return searchSite(input);
    case 'get_country':
      return getCountry(input);
    case 'get_project':
      return getProject(input);
    case 'query_aiddata':
      return queryAidData(input);
    case 'get_overview':
      return getOverview();
    default:
      return { error: `Unknown tool ${name}` };
  }
}
