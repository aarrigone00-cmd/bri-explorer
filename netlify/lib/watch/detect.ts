// Project Watcher rules: how each project is searched for, and how headlines
// are read for likely status changes. Plain keyword rules, no AI. Pure
// functions so they can be tested offline.
import { STATUS_LABELS } from '../../../src/labels';
import { norm } from '../../../src/lib/text-match';
import type { Project, ProjectStatus } from '../../../src/types';

export interface Article {
  url: string;
  title: string;
  domain: string;
  /** YYYY-MM-DD */
  date: string;
}

/** Hand-written searches where the project name alone searches badly. */
const QUERY_OVERRIDES: Record<string, string> = {
  'jakarta-bandung-hsr': '("Jakarta Bandung" OR Whoosh) "high speed"',
  'mombasa-nairobi-sgr': '("Mombasa Nairobi" OR "Kenya SGR") railway',
  'addis-djibouti-railway': '"Addis Ababa Djibouti" railway',
  'budapest-belgrade-railway': '"Budapest Belgrade" railway',
  'lagos-ibadan-railway': '"Lagos Ibadan" railway',
  'thai-chinese-hsr': '"Nakhon Ratchasima" "high speed"',
  'cat-linh-ha-dong': '"Cat Linh" metro',
  'kkh-havelian-thakot': '"Havelian Thakot"',
  'multan-sukkur-motorway': '"Multan Sukkur"',
  'bar-boljare-motorway': '"Bar Boljare"',
  'matiari-lahore-hvdc': '"Matiari Lahore"',
  'myanmar-china-pipelines': '"Myanmar China" pipeline',
  'noor-energy-1': '"Noor Energy 1"',
  'great-stone-industrial-park': '"Great Stone" industrial park',
  'egypt-new-capital-cbd': '"New Administrative Capital" China',
  'morowali-industrial-park': '"Morowali Industrial Park"',
  'lower-sesan-2': '"Lower Sesan"',
  'colombo-port-city': '"Colombo Port City"',
  'piraeus-port': 'Piraeus port COSCO',
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** GDELT search for a project: its name as a phrase, unless overridden. */
export function watchQuery(p: Project): string {
  if (QUERY_OVERRIDES[p.id]) return QUERY_OVERRIDES[p.id];
  const name = plain(p.name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/[–—-]/g, ' ')
    .replace(/\b(modernisation|project)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `"${name}"`;
}

const GENERIC = new Set(
  'railway rail line metro high speed standard gauge port deep sea international bridge road highway motorway expressway section phase power plant coal thermal hydroelectric hydropower dam project solar park energy industrial city central business district new airport oil gas pipelines pipeline transmission the and of china chinese gateway dry kv hvdc'.split(' '),
);

/** Distinctive words of a project's name (place names, mostly). */
export function distinctiveWords(p: Project): string[] {
  const words = norm(`${p.name} ${QUERY_OVERRIDES[p.id] ?? ''}`).split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w)))];
}

/** Headline wording that suggests each status. Checked in this order. */
const STATUS_SIGNALS: { status: ProjectStatus; words: string[]; from: ProjectStatus[] }[] = [
  { status: 'cancelled', words: ['cancel', 'scrapped', 'scraps', 'scrap ', 'terminated', 'terminates', 'abandon', 'pulls out of', 'withdraws from'], from: ['planned', 'under-construction', 'suspended', 'partially-operational'] },
  { status: 'suspended', words: ['suspend', 'halted', 'halts', 'stalled', 'stalls', 'paused', 'pauses', 'frozen', 'freezes', 'put on hold', 'shut down', 'shuts down'], from: ['planned', 'under-construction', 'partially-operational', 'operational'] },
  { status: 'operational', words: ['inaugurat', 'opens to', 'opened to', 'officially opens', 'officially opened', 'begins operation', 'starts operation', 'commercial operation', 'first train', 'maiden voyage', 'commissioned', 'launches service', 'starts service', 'enters service', 'fully operational'], from: ['planned', 'under-construction', 'partially-operational', 'suspended'] },
  { status: 'under-construction', words: ['groundbreaking', 'breaks ground', 'broke ground', 'construction begins', 'construction starts', 'construction began', 'begins construction', 'starts construction', 'work begins', 'resumes construction', 'construction resumes', 'work resumes'], from: ['planned', 'suspended'] },
];

export interface StatusSignal {
  status: ProjectStatus;
  article: Article;
}

/** The first headline that names the project and uses status-change wording. */
export function detectStatus(p: Project, articles: Article[]): StatusSignal | null {
  const own = distinctiveWords(p);
  for (const sig of STATUS_SIGNALS) {
    if (!sig.from.includes(p.status) || sig.status === p.status) continue;
    for (const a of articles) {
      const t = ` ${norm(a.title)} `;
      if (!own.some((w) => t.includes(w))) continue;
      if (sig.words.some((w) => t.includes(w))) return { status: sig.status, article: a };
    }
  }
  return null;
}

/** Enough articles in two weeks to be worth a look even without a status signal. */
export const NOTABLE_COVERAGE = 3;

export interface Finding {
  project_id: string;
  current_status: ProjectStatus;
  suggested_status: ProjectStatus;
  status_note: string;
  summary: string;
  as_of: string;
  sources: { url: string; title: string; publisher: string }[];
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** A suggestion for the admin, or null when nothing is worth flagging. */
export function findingFor(p: Project, fresh: Article[], today: string): Finding | null {
  if (!fresh.length) return null;
  const signal = detectStatus(p, fresh);
  if (!signal && fresh.length < NOTABLE_COVERAGE) return null;
  const lead = signal?.article ?? fresh[0];
  const ordered = [lead, ...fresh.filter((a) => a !== lead)];
  const n = fresh.length;
  const status_note = signal
    ? clip(`Headline suggests "${STATUS_LABELS[signal.status]}": "${lead.title}" (${lead.domain}, ${lead.date}). Check the article before approving.`, 500)
    : clip(`${n} new articles in the past two weeks; no status change detected in the headlines. Latest: "${lead.title}" (${lead.domain}, ${lead.date}).`, 500);
  const summary = clip(
    `${n} new ${n === 1 ? 'article' : 'articles'} found by searching GDELT for ${watchQuery(p)}. Headlines: ${ordered
      .slice(0, 5)
      .map((a) => `"${a.title}" (${a.domain})`)
      .join('; ')}.`,
    1000,
  );
  return {
    project_id: p.id,
    current_status: p.status,
    suggested_status: signal?.status ?? p.status,
    status_note,
    summary,
    as_of: today,
    sources: ordered.slice(0, 4).map((a) => ({ url: a.url, title: clip(a.title, 300), publisher: a.domain })),
  };
}
