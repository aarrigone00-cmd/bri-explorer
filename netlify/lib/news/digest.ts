// Turns raw feed items into the weekly "China & the World" digest using plain
// keyword rules: no AI. Pure functions, so they can be tested offline.
import { countKeywords, createCountryMatcher, norm } from '../../../src/lib/text-match';
import countryNames from '../../../public/data/country-names.json' with { type: 'json' };
import type { Feed } from './feeds';
import type { FeedItem } from './rss';

export interface DigestSource {
  url: string;
  title: string;
  publisher: string;
}

export interface DigestItem {
  headline: string;
  date: string;
  summary: string;
  why_it_matters: string;
  perspectives: string;
  topic: string;
  countries: string[];
  bri_related: boolean;
  sources: DigestSource[];
}

export interface Digest {
  overview: string;
  items: DigestItem[];
}

export const NEWS_TOPICS: { name: string; keywords: string[] }[] = [
  {
    name: 'Belt and Road & development finance',
    keywords: ['belt and road', 'bri ', 'bri,', 'bri.', 'silk road', 'infrastructure', 'loan', 'debt', 'railway', 'port ', 'ports', 'seaport', 'investment', 'development bank', 'aiib', 'power plant', 'mining'],
  },
  {
    name: 'Diplomacy',
    keywords: ['foreign minister', 'wang yi', 'summit', 'visit', 'talks', 'ties', 'relations', 'ambassador', 'embassy', 'diplomat', 'bilateral', 'envoy', 'partnership', 'condemn', 'urges', 'tells'],
  },
  {
    name: 'Trade & economy',
    keywords: ['tariff', 'trade', 'export', 'import', 'rare earth', 'supply chain', 'sanction', 'yuan', 'economy', 'economic', 'market', 'soybean', 'steel', 'electric vehicle'],
  },
  {
    name: 'Security',
    keywords: ['military', 'pla ', "people's liberation army", 'navy', 'naval', 'coast guard', 'drill', 'missile', 'warship', 'defence', 'defense', 'south china sea', 'taiwan strait', 'troops', 'nuclear', 'espionage', 'spy', 'war ', 'war,', 'war.', 'wars', 'ceasefire', 'border'],
  },
  {
    name: 'Global governance',
    keywords: ['united nations', 'security council', 'g20', 'brics', 'shanghai cooperation', 'wto', 'climate', 'cop3', 'apec', 'asean', 'g7', 'world bank', 'imf', 'multilateral'],
  },
  {
    name: 'Technology & standards',
    keywords: ['semiconductor', 'chip', 'artificial intelligence', 'huawei', '5g', 'technology', 'tech ', 'export control', 'tiktok', 'cyber', 'satellite', 'space'],
  },
];

const CHINA_SIGNAL = ['china', 'chinese', 'beijing', 'xi jinping', "xi's", 'president xi', 'prc', 'sino-', 'taiwan', 'hong kong', 'xinjiang', 'tibet', 'south china sea'];
const BRI_SIGNAL = ['belt and road', 'bri ', 'bri,', 'bri.', 'new silk road', 'silk road', 'aiib', 'cpec', 'china-pakistan economic corridor', 'debt trap', 'chinese loan', 'chinese-built', 'chinese-funded', 'chinese-financed', 'exim bank', 'china development bank'];

const matcher = createCountryMatcher(countryNames as Record<string, string>, ['CHN', 'HKG', 'MAC']);
const nameOf = (iso3: string) => (countryNames as Record<string, string>)[iso3] ?? iso3;

const MAX_ITEMS = 12;
const MAX_PER_OUTLET = 3;
const SUMMARY_LENGTH = 280;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[\s,;:.–—-]+$/, '')}…`;
}

const words = (s: string) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter || 1);
}

interface Candidate extends DigestItem {
  feedId: string;
  score: number;
  words: Set<string>;
}

/** Scores, filters and de-duplicates one week of feed items into a digest. */
export function buildDigest(results: { feed: Feed; items: FeedItem[] }[], now = new Date()): Digest {
  const since = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const candidates: Candidate[] = [];

  for (const { feed, items } of results) {
    for (const it of items) {
      const t = Date.parse(it.published);
      if (!Number.isFinite(t) || t < since || t > now.getTime() + 60 * 60 * 1000) continue;
      const titleN = ` ${norm(it.title)} `;
      const textN = ` ${norm(`${it.title}. ${it.description}`)} `;
      const china = countKeywords(titleN, CHINA_SIGNAL) > 0 || (feed.chinaOnly ?? false) || countKeywords(norm(it.description.slice(0, 200)), CHINA_SIGNAL) > 0;
      if (!china) continue;
      const countries = matcher.find(`${it.title}. ${it.description}`).slice(0, 6);
      const scores = NEWS_TOPICS.map((tp) => ({ name: tp.name, n: countKeywords(textN, tp.keywords) + 2 * countKeywords(titleN, tp.keywords) }));
      const best = scores.reduce((a, b) => (b.n > a.n ? b : a));
      const bri = countKeywords(textN, BRI_SIGNAL) > 0;
      // Foreign policy only: at least one topic keyword must appear.
      if (best.n === 0) continue;
      const desc = it.description && norm(it.description) !== norm(it.title) ? truncate(it.description, SUMMARY_LENGTH) : '';
      candidates.push({
        headline: truncate(it.title, 200),
        date: new Date(t).toISOString().slice(0, 10),
        summary: desc,
        why_it_matters: '',
        perspectives: '',
        topic: bri ? NEWS_TOPICS[0].name : best.n > 0 ? best.name : 'Diplomacy',
        countries,
        bri_related: bri,
        sources: [{ url: it.url, title: truncate(it.title, 200), publisher: feed.note ? `${feed.publisher} (${feed.note})` : feed.publisher }],
        feedId: feed.id,
        score: (bri ? 4 : 0) + Math.min(best.n, 4) + Math.min(countries.length, 3) + (t - since) / (7 * 24 * 60 * 60 * 1000),
        words: words(it.title),
      });
    }
  }

  // Same story from several outlets: keep the best-scoring one, add the others as sources.
  candidates.sort((a, b) => b.score - a.score);
  const merged: Candidate[] = [];
  for (const c of candidates) {
    const dup = merged.find((m) => similarity(m.words, c.words) >= 0.5 || m.sources.some((s) => s.url === c.sources[0].url));
    if (dup) {
      if (dup.sources.length < 4 && !dup.sources.some((s) => s.url === c.sources[0].url)) dup.sources.push(c.sources[0]);
      for (const iso of c.countries) if (!dup.countries.includes(iso) && dup.countries.length < 6) dup.countries.push(iso);
      dup.bri_related ||= c.bri_related;
      dup.score += 1;
      continue;
    }
    merged.push(c);
  }
  merged.sort((a, b) => b.score - a.score);

  const perOutlet = new Map<string, number>();
  const picked: Candidate[] = [];
  for (const c of merged) {
    const n = perOutlet.get(c.feedId) ?? 0;
    if (n >= MAX_PER_OUTLET) continue;
    perOutlet.set(c.feedId, n + 1);
    picked.push(c);
    if (picked.length >= MAX_ITEMS) break;
  }
  picked.sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
  const items: DigestItem[] = picked.map(({ feedId: _f, score: _s, words: _w, ...item }) => item);
  return { overview: overviewFor(items), items };
}

function topCounts(values: string[], n: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A factual, template-written overview of what the digest contains. */
export function overviewFor(items: DigestItem[]): string {
  if (!items.length) return '';
  const outlets = new Set(items.flatMap((i) => i.sources.map((s) => s.publisher.replace(/ \(.*\)$/, ''))));
  const topics = topCounts(items.map((i) => i.topic), 3).map(([t, n]) => `${t.toLowerCase()} (${n})`);
  const countries = topCounts(items.flatMap((i) => i.countries), 5).filter(([, n]) => n > 1 || items.length < 4).map(([c]) => nameOf(c));
  const bri = items.filter((i) => i.bri_related).length;
  const parts = [
    `${items.length} ${items.length === 1 ? 'story' : 'stories'} on China's foreign relations from ${outlets.size} ${outlets.size === 1 ? 'outlet' : 'outlets'} over the past week.`,
    `Most covered: ${list(topics)}.`,
  ];
  if (countries.length) parts.push(`Countries mentioned most: ${list(countries)}.`);
  parts.push(bri ? `${bri} ${bri === 1 ? 'story mentions' : 'stories mention'} the Belt and Road or Chinese development finance.` : 'No story this week mentions the Belt and Road directly.');
  return parts.join(' ').slice(0, 1000);
}
