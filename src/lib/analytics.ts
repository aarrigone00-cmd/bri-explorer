// Pure functions over the dataset. Everything shown in the dashboard is
// computed here from the loaded data — nothing is hard-coded.
import type { CostBasis, Dataset, FinanceRecord, ParticipationCountry, Project, ProjectStatus, ProjectType } from '../types';

export type ParticipationStatus = 'participant' | 'exited' | 'unconfirmed' | 'not-yet' | 'none';

const yearOf = (iso: string | null): number | null => (iso ? Number(iso.slice(0, 4)) : null);

export function participationAt(c: ParticipationCountry | undefined, year: number): ParticipationStatus {
  if (!c) return 'none';
  const exit = yearOf(c.exitDate);
  if (exit !== null && exit <= year) return 'exited';
  const mou = yearOf(c.mouDate);
  if (mou === null) return 'unconfirmed';
  return mou <= year ? 'participant' : 'not-yet';
}

/** Projects are shown from their start year; undated projects always show. */
export function projectVisibleAt(p: Project, year: number): boolean {
  return p.startYear === null || p.startYear <= year;
}

/** Status as it would have been at the end of `year` (for the timeline). */
export function projectStatusAt(p: Project, year: number): ProjectStatus {
  if (p.completionYear !== null && p.completionYear > year) {
    return p.status === 'planned' ? 'planned' : 'under-construction';
  }
  return p.status;
}

export function yearRange(d: Dataset): { min: number; max: number } {
  const years: number[] = [];
  for (const p of d.projects) {
    if (p.startYear) years.push(p.startYear);
    if (p.completionYear) years.push(p.completionYear);
  }
  for (const c of d.participation) {
    const m = yearOf(c.mouDate);
    const e = yearOf(c.exitDate);
    if (m) years.push(m);
    if (e) years.push(e);
  }
  for (const r of d.records) {
    if (r.commitmentYear) years.push(r.commitmentYear);
  }
  const asOf = Number(d.projectsMeta.asOf.slice(0, 4));
  if (asOf) years.push(asOf);
  return { min: 2013, max: Math.max(...years) };
}

export interface Stats {
  year: number;
  participants: number;
  exited: number;
  unconfirmed: number;
  projectCount: number;
  projectCountries: number;
  byType: [ProjectType, number][];
  byRegion: [string, number][];
  byStatus: [ProjectStatus, number][];
  participantsByRegion: [string, number][];
  finance: { basis: CostBasis; totalUsdMillions: number; count: number }[];
  projectsWithFigure: number;
  projectsWithoutFigure: number;
}

const tally = <K extends string>(items: K[]): [K, number][] => {
  const m = new Map<K, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function computeStats(d: Dataset, year: number): Stats {
  const byIso = new Map(d.participation.map((c) => [c.iso3, c]));
  const statuses = d.participation.map((c) => [c, participationAt(c, year)] as const);
  const projects = d.projects.filter((p) => projectVisibleAt(p, year));
  const hostCountries = new Set(projects.flatMap((p) => p.countries.filter((c) => c !== 'CHN')));

  const financeMap = new Map<CostBasis, { total: number; count: number }>();
  for (const p of projects) {
    const amt = p.cost.amountUsdMillions;
    if (amt === null) continue;
    const e = financeMap.get(p.cost.basis) ?? { total: 0, count: 0 };
    e.total += amt;
    e.count += 1;
    financeMap.set(p.cost.basis, e);
  }
  const withFigure = projects.filter((p) => p.cost.amountUsdMillions !== null).length;

  return {
    year,
    participants: statuses.filter(([, s]) => s === 'participant').length,
    exited: statuses.filter(([, s]) => s === 'exited').length,
    unconfirmed: statuses.filter(([, s]) => s === 'unconfirmed').length,
    projectCount: projects.length,
    projectCountries: hostCountries.size,
    byType: tally(projects.map((p) => p.type)),
    // A project spanning several regions counts once per region.
    byRegion: tally(
      projects.flatMap((p) => [
        ...new Set(p.countries.filter((c) => c !== 'CHN').map((c) => byIso.get(c)?.region ?? 'Other')),
      ]),
    ),
    byStatus: tally(projects.map((p) => projectStatusAt(p, year))),
    participantsByRegion: tally(statuses.filter(([, s]) => s === 'participant').map(([c]) => c.region)),
    finance: [...financeMap.entries()]
      .map(([basis, v]) => ({ basis, totalUsdMillions: v.total, count: v.count }))
      .sort((a, b) => b.totalUsdMillions - a.totalUsdMillions),
    projectsWithFigure: withFigure,
    projectsWithoutFigure: projects.length - withFigure,
  };
}

export function formatUsdMillions(m: number): string {
  return m >= 1000 ? `US$${(m / 1000).toFixed(1)} bn` : `US$${Math.round(m)} m`;
}

// ---- AidData finance records ---------------------------------------------------

/** Records appear on the timeline in the year the finance was committed. */
export function recordVisibleAt(r: FinanceRecord, year: number): boolean {
  return r.commitmentYear === null || r.commitmentYear <= year;
}

export function recordStatusAt(r: FinanceRecord, year: number): ProjectStatus {
  if (r.completionYear !== null && r.completionYear <= year) return 'completed';
  if (r.startYear !== null && r.startYear <= year) return r.status === 'completed' ? 'under-construction' : r.status;
  if (r.completionYear !== null || r.startYear !== null) return 'planned';
  return r.status;
}

export interface RecordStats {
  count: number;
  countries: number;
  withAmount: number;
  totalUsd: number;
  byType: [ProjectType, number][];
  amountByType: [ProjectType, number][];
  amountByYear: [string, number][];
  topCountries: [string, number][];
  topLenders: [string, number][];
}

export function computeRecordStats(records: FinanceRecord[], year: number): RecordStats {
  const visible = records.filter((r) => recordVisibleAt(r, year));
  const sumBy = <K extends string>(key: (r: FinanceRecord) => K | null) => {
    const m = new Map<K, number>();
    for (const r of visible) {
      const k = key(r);
      if (k === null || r.amountUsd2021 === null) continue;
      m.set(k, (m.get(k) ?? 0) + r.amountUsd2021);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const withAmount = visible.filter((r) => r.amountUsd2021 !== null);
  return {
    count: visible.length,
    countries: new Set(visible.map((r) => r.iso3)).size,
    withAmount: withAmount.length,
    totalUsd: withAmount.reduce((s, r) => s + r.amountUsd2021!, 0),
    byType: tally(visible.map((r) => r.type)),
    amountByType: sumBy((r) => r.type),
    amountByYear: sumBy((r) => (r.commitmentYear ? String(r.commitmentYear) : null)).sort((a, b) => a[0].localeCompare(b[0])),
    topCountries: sumBy((r) => r.iso3).slice(0, 8),
    topLenders: tally(visible.map((r) => r.lender ?? 'Not stated in record title')).slice(0, 6),
  };
}

/** Compact USD formatting for whole-dollar amounts. */
export function formatUsd(v: number): string {
  if (v >= 1e9) return `US$${(v / 1e9).toFixed(v >= 1e11 ? 0 : 1)} bn`;
  if (v >= 1e6) return `US$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)} m`;
  return `US$${Math.round(v).toLocaleString('en-US')}`;
}
