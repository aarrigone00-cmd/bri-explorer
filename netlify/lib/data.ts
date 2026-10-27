// The site's published datasets, bundled into the functions so agents answer
// from exactly the data the map shows.
import projectsJson from '../../public/data/projects.json' with { type: 'json' };
import participationJson from '../../public/data/participation.json' with { type: 'json' };
import corridorsJson from '../../public/data/corridors.json' with { type: 'json' };
import recordsJson from '../../public/data/aiddata-records.json' with { type: 'json' };
import engagementJson from '../../public/data/bri-engagement.json' with { type: 'json' };
import sourcesJson from '../../public/data/sources.json' with { type: 'json' };
import type { Corridor, Engagement, FinanceRecord, ParticipationCountry, Project, Source } from '../../src/types';

export const projects = projectsJson.projects as unknown as Project[];
export const projectsAsOf = projectsJson.meta.asOf;
export const participation = participationJson.countries as unknown as ParticipationCountry[];
export const corridors = corridorsJson.corridors as unknown as Corridor[];
export const records = recordsJson.records as unknown as FinanceRecord[];
export const engagement = engagementJson as unknown as Engagement;
export const sources = sourcesJson.sources as unknown as Source[];

export const countryByIso = new Map(participation.map((c) => [c.iso3, c]));
export const projectById = new Map(projects.map((p) => [p.id, p]));
export const recordById = new Map(records.map((r) => [r.id, r]));

// Recipients in the AidData extract that are not on the GFDC BRI list, so
// have no entry in participation.json (generated from the data; see README).
const extraNames: Record<string, string> = {
  PRK: 'North Korea', PSE: 'Palestine', MUS: 'Mauritius', IND: 'India', MEX: 'Mexico', STP: 'São Tomé and Príncipe',
  BRA: 'Brazil', BFA: 'Burkina Faso', ISR: 'Israel', PRY: 'Paraguay', MHL: 'Marshall Islands',
};
export const countryName = (iso3: string) => countryByIso.get(iso3)?.name ?? extraNames[iso3] ?? (iso3 || 'Multiple / unspecified');
export const countryRegion = (iso3: string) => countryByIso.get(iso3)?.region ?? 'Not on the GFDC BRI list';

/** Lower-case, accent-free text for matching. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** AidData titles read "Lender provides $X for <project>"; return the project part. */
export function recordShortTitle(r: FinanceRecord): string {
  const m = r.title.match(/\bfor (?:the )?(.+)$/i);
  const t = (m ? m[1] : r.title).replace(/\s*\((?:linked|Linked)[^)]*\)?\s*$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
