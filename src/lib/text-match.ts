// Text matching shared by the browser agents (Ask the Map) and the server
// agents (news, Project Watcher). No browser-only or Node-only APIs here.

/** Lower-case, accent-free, apostrophes normalised. */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extra ways countries are written in headlines and questions. Entries in
 * UPPER CASE are matched case-sensitively (so "US" doesn't match "us").
 */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  USA: ['United States', 'U.S.', 'US', 'USA', 'America', 'American'],
  GBR: ['United Kingdom', 'Britain', 'British', 'UK', 'U.K.'],
  RUS: ['Russia', 'Russian', 'Kremlin'],
  JPN: ['Japan', 'Japanese'],
  IND: ['India', 'Indian'],
  PAK: ['Pakistan', 'Pakistani'],
  KOR: ['South Korea', 'South Korean'],
  PRK: ['North Korea', 'North Korean', 'Pyongyang'],
  TWN: ['Taiwan', 'Taiwanese'],
  PHL: ['Philippines', 'Philippine', 'Filipino'],
  VNM: ['Vietnam', 'Viet Nam', 'Vietnamese'],
  LAO: ['Laos', 'Lao PDR'],
  MMR: ['Myanmar', 'Burma'],
  KHM: ['Cambodia', 'Cambodian'],
  IDN: ['Indonesia', 'Indonesian'],
  MYS: ['Malaysia', 'Malaysian'],
  THA: ['Thailand', 'Thai'],
  AUS: ['Australia', 'Australian'],
  IRN: ['Iran', 'Iranian'],
  ISR: ['Israel', 'Israeli'],
  PSE: ['Palestine', 'Palestinian', 'West Bank', 'Gaza'],
  SAU: ['Saudi Arabia', 'Saudi'],
  ARE: ['United Arab Emirates', 'UAE', 'Emirati'],
  TUR: ['Turkey', 'Türkiye', 'Turkiye', 'Turkish'],
  EGY: ['Egypt', 'Egyptian'],
  COD: ['Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo-Kinshasa'],
  COG: ['Republic of the Congo', 'Congo-Brazzaville', 'Republic of Congo'],
  CIV: ["Côte d'Ivoire", 'Ivory Coast'],
  CZE: ['Czech Republic', 'Czechia'],
  KGZ: ['Kyrgyzstan', 'Kyrgyz Republic'],
  SRB: ['Serbia', 'Serbian'],
  HUN: ['Hungary', 'Hungarian'],
  DEU: ['Germany', 'German'],
  FRA: ['France', 'French'],
  BRA: ['Brazil', 'Brazilian'],
  KEN: ['Kenya', 'Kenyan'],
  NGA: ['Nigeria', 'Nigerian'],
  ETH: ['Ethiopia', 'Ethiopian'],
  ZAF: ['South Africa', 'South African'],
  SSD: ['South Sudan'],
  CAF: ['Central African Republic'],
  DOM: ['Dominican Republic'],
  BIH: ['Bosnia and Herzegovina', 'Bosnia'],
  MKD: ['North Macedonia'],
  GNQ: ['Equatorial Guinea'],
  PNG: ['Papua New Guinea'],
  SLB: ['Solomon Islands'],
  FSM: ['Micronesia'],
  SYR: ['Syria', 'Syrian'],
};

export interface CountryMatcher {
  /** ISO3 codes mentioned in the text, in order of first mention. */
  find(text: string): string[];
}

/**
 * Builds a matcher from ISO3 → name (e.g. Natural Earth names) plus the
 * aliases above. Longer names are matched first so "Equatorial Guinea" never
 * also counts as "Guinea", and "Niger" never matches inside "Nigeria".
 */
export function createCountryMatcher(names: Record<string, string>, exclude: string[] = ['CHN']): CountryMatcher {
  const entries: { iso3: string; label: string; caseSensitive: boolean }[] = [];
  const add = (iso3: string, label: string) => {
    if (!label || exclude.includes(iso3)) return;
    const caseSensitive = label.length <= 4 && label === label.toUpperCase();
    entries.push({ iso3, label, caseSensitive });
  };
  for (const [iso3, name] of Object.entries(names)) add(iso3, name);
  for (const [iso3, list] of Object.entries(COUNTRY_ALIASES)) for (const a of list) add(iso3, a);
  entries.sort((a, b) => b.label.length - a.label.length);
  const compiled = entries.map((e) => ({
    iso3: e.iso3,
    re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.caseSensitive ? e.label : norm(e.label))}(?=$|[^\\p{L}\\p{N}])`, e.caseSensitive ? 'gu' : 'giu'),
    caseSensitive: e.caseSensitive,
  }));

  return {
    find(text: string) {
      let lower = norm(text);
      let raw = text;
      const hits: { iso3: string; at: number }[] = [];
      for (const c of compiled) {
        const src = c.caseSensitive ? raw : lower;
        c.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let found = -1;
        while ((m = c.re.exec(src))) {
          const start = m.index + m[1].length;
          if (found < 0) found = start;
          // Blank out the match so shorter names can't match inside it.
          const blank = ' '.repeat(m[0].length - m[1].length);
          lower = lower.slice(0, start) + blank + lower.slice(start + blank.length);
          raw = raw.slice(0, start) + blank + raw.slice(start + blank.length);
          c.re.lastIndex = start + blank.length;
        }
        if (found < 0) continue;
        const prev = hits.find((h) => h.iso3 === c.iso3);
        if (!prev) hits.push({ iso3: c.iso3, at: found });
        else prev.at = Math.min(prev.at, found);
      }
      return hits.sort((a, b) => a.at - b.at).map((h) => h.iso3);
    },
  };
}

/** Counts how many of the keywords occur (as words or phrases) in normalised text. */
export function countKeywords(normText: string, keywords: string[]): number {
  let n = 0;
  for (const k of keywords) if (new RegExp(`(^|[^\\p{L}])${escapeRe(k)}`, 'u').test(normText)) n += 1;
  return n;
}
