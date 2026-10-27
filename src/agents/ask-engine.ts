// Agent 1, "Ask the Map": a rule-based question engine that runs in the
// browser. It recognises countries, projects, corridors, regions, sectors,
// lenders and years in a question, picks the kind of answer that fits, and
// answers only from the site's datasets, citing them. No AI and no server.
import { computeRecordStats, formatUsd, participationAt, yearRange } from '../lib/analytics';
import { COUNTRY_ALIASES, createCountryMatcher, norm } from '../lib/text-match';
import { STATUS_LABELS, TYPE_PLURALS } from '../labels';
import type { Corridor, Dataset, FinanceRecord, LayerKey, ParticipationCountry, Project, ProjectStatus, ProjectType } from '../types';

export type MapAction =
  | { action: 'focus_country'; iso3: string }
  | { action: 'focus_project'; id: string }
  | { action: 'focus_record'; id: number }
  | { action: 'set_year'; year: number }
  | { action: 'add_layers'; layers: LayerKey[] };

export interface AskReply {
  /** Safe Markdown (rendered by renderMarkdown). */
  reply: string;
  actions: MapAction[];
}

/** What the previous answer was about, for follow-ups like "what about its railways?". */
export interface AskContext {
  countries: string[];
  projects: string[];
}

const TYPE_WORDS: Record<ProjectType, string[]> = {
  rail: ['rail', 'railway', 'railways', 'train', 'trains', 'metro', 'high-speed', 'high speed', 'sgr'],
  port: ['port', 'ports', 'harbour', 'harbor', 'seaport', 'maritime'],
  road: ['road', 'roads', 'highway', 'highways', 'motorway', 'expressway', 'bridge', 'bridges'],
  energy: ['energy', 'power', 'electricity', 'dam', 'dams', 'hydro', 'hydropower', 'coal', 'solar', 'pipeline', 'pipelines', 'oil', 'gas', 'grid'],
  other: ['industrial park', 'industrial parks', 'airport', 'airports', 'special economic zone', 'urban'],
};

const REGION_WORDS: [string, string[]][] = [
  ['Sub-Saharan Africa', ['sub-saharan africa', 'africa', 'african']],
  ['Middle East & North Africa', ['middle east', 'north africa', 'gulf', 'mena']],
  ['East Asia & Pacific', ['east asia', 'southeast asia', 'south-east asia', 'pacific', 'asean']],
  ['South Asia', ['south asia']],
  ['Europe & Central Asia', ['europe', 'european', 'central asia', 'balkans', 'caucasus']],
  ['Latin America & Caribbean', ['latin america', 'south america', 'caribbean', 'central america']],
];

const LENDER_WORDS: [string, string[]][] = [
  ['Export-Import Bank of China (China Eximbank)', ['exim', 'eximbank', 'export-import', 'export import']],
  ['China Development Bank (CDB)', ['china development bank', 'cdb']],
  ['Industrial and Commercial Bank of China (ICBC)', ['icbc', 'industrial and commercial bank']],
  ['Bank of China', ['bank of china']],
  ['Chinese Government', ['chinese government', 'government grants', 'grant', 'grants']],
];

const CORRIDOR_WORDS: Record<string, string[]> = {
  'new-eurasian-land-bridge': ['eurasian land bridge', 'land bridge', 'china-europe railway', 'china europe railway'],
  'china-mongolia-russia': ['mongolia-russia', 'mongolia russia', 'china-mongolia', 'china mongolia'],
  'china-central-west-asia': ['central asia-west asia', 'central asia west asia', 'west asia corridor'],
  'china-indochina': ['indochina', 'indo-china'],
  cpec: ['cpec', 'china-pakistan economic', 'china pakistan economic', 'pakistan corridor'],
  bcim: ['bcim', 'china-myanmar economic', 'china myanmar economic', 'bangladesh-china-india-myanmar'],
};

const STATUS_WORDS: [ProjectStatus, string[]][] = [
  ['under-construction', ['under construction', 'being built', 'construction']],
  ['planned', ['planned', 'proposed', 'agreed']],
  ['operational', ['operational', 'in operation', 'completed', 'finished', 'open']],
  ['suspended', ['suspended', 'stalled', 'halted']],
  ['cancelled', ['cancelled', 'canceled', 'scrapped']],
];

const GENERIC_NAME_WORDS = new Set(
  'the and of for new phase line section project international deep sea standard gauge high speed central business district industrial park power plant thermal coal hydroelectric hydropower dam solar energy railway rail metro port bridge road highway motorway expressway airport city oil gas pipelines pipeline transmission stake modernisation multipurpose gateway dry friendship kv hvdc'.split(' '),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when any of the words or phrases occurs as whole words in normalised text. */
const has = (q: string, words: string[]) => words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(q));
const unique = <T>(xs: T[]) => [...new Set(xs)];
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** GFDC figures are in US$ billion. */
const usdBn = (v: number) => (v < 1 ? `US$${Math.round(v * 1000)} million` : `US$${v} billion`);
const recordTitle = (r: FinanceRecord) => {
  const m = r.title.match(/\bfor (?:the )?(.+)$/i);
  const t = (m ? m[1] : r.title).replace(/\s*\((?:linked|Linked)[^)]*\)?\s*$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export interface AskEngine {
  answer(question: string, context?: AskContext): AskReply & { context: AskContext };
}

export function createAskEngine(data: Dataset): AskEngine {
  const countryByIso = new Map(data.participation.map((c) => [c.iso3, c]));
  const names: Record<string, string> = {};
  const allNames: string[] = Object.values(COUNTRY_ALIASES).flat();
  for (const f of data.world.features) if (f.properties.iso3) names[f.properties.iso3] = f.properties.name;
  for (const f of data.world.features) allNames.push(f.properties.name);
  for (const c of data.participation) {
    names[c.iso3] = c.name;
    allNames.push(c.name);
  }
  const nameOf = (iso3: string) => names[iso3] ?? iso3;
  // The matcher knows both the GFDC names ("Lao PDR") and Natural Earth's ("Laos").
  const worldNames: Record<string, string> = {};
  for (const f of data.world.features) if (f.properties.iso3) worldNames[f.properties.iso3] = f.properties.name;
  const gfdcMatcher = createCountryMatcher(names, ['CHN', 'HKG', 'MAC']);
  const worldMatcher = createCountryMatcher(worldNames, ['CHN', 'HKG', 'MAC']);
  const matcher = { find: (text: string) => unique([...gfdcMatcher.find(text), ...worldMatcher.find(text)]) };
  const sourceById = new Map(data.sources.map((s) => [s.id, s]));
  const cite = (ids: string[]) =>
    `*Source${ids.length > 1 ? 's' : ''}: ${unique(ids)
      .map((id) => sourceById.get(id))
      .filter((s) => s !== undefined)
      .map((s) => `[${s.title.split(/[:(,—]/)[0].trim()}](${s.url})`)
      .join('; ')}.*`;
  const { max: currentYear } = yearRange(data);

  // Words that are part of a country's name don't identify a project alone.
  const countryWords = new Set(allNames.flatMap((n) => norm(n).split(/[^\p{L}\p{N}]+/u)));
  const projectWords = data.projects.map((p) => {
    const paren = [...p.name.matchAll(/\(([^)]+)\)/g)].map((m) => norm(m[1]));
    const words = unique(norm(p.name.replace(/\([^)]*\)/g, ' ')).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !GENERIC_NAME_WORDS.has(w)));
    return { p, words, paren };
  });
  const wordUse = new Map<string, number>();
  for (const { words } of projectWords) for (const w of words) wordUse.set(w, (wordUse.get(w) ?? 0) + 1);

  function findProjects(q: string): Project[] {
    const scored = projectWords.map(({ p, words, paren }) => {
      let score = 0;
      for (const alias of paren) if (alias.length >= 4 && q.includes(alias)) score += 3;
      for (const w of words) {
        if (!has(q, [w])) continue;
        score += countryWords.has(w) || (wordUse.get(w) ?? 0) > 1 ? 1 : 2;
      }
      if (score > 0 && has(q, TYPE_WORDS[p.type])) score += 1;
      return { p, score };
    });
    const best = Math.max(0, ...scored.map((s) => s.score));
    return best >= 2 ? scored.filter((s) => s.score === best).map((s) => s.p) : [];
  }

  const recordsIn = (iso3: string) => data.records.filter((r) => r.iso3 === iso3);
  const projectsIn = (iso3: string) => data.projects.filter((p) => p.countries.includes(iso3));

  function participationLine(iso3: string): string {
    const c = countryByIso.get(iso3);
    if (!c) return `${nameOf(iso3)} is not on the GFDC list of Belt and Road countries.`;
    const s = participationAt(c, currentYear);
    if (s === 'exited') return `${c.name} (${c.region}) signed a Belt and Road MoU${c.mouDate ? ` in ${c.mouDate.slice(0, 4)}` : ''} and later left the initiative (${c.exitDate!.slice(0, 4)}).`;
    if (s === 'unconfirmed') return `${c.name} (${c.region}) is on the GFDC list of Belt and Road countries, but GFDC could not independently confirm its MoU date.`;
    return `${c.name} (${c.region}, ${c.incomeGroup.toLowerCase()}) signed a Belt and Road MoU in ${c.mouDate!.slice(0, 4)}.`;
  }

  function recordSummary(records: FinanceRecord[]): string[] {
    const st = computeRecordStats(records, currentYear);
    if (!st.count) return [];
    const lines = [`**AidData finance records:** ${plural(st.count, 'record')} of Chinese official loans and grants (2000–2021), ${st.withAmount ? `${formatUsd(st.totalUsd)} committed (constant 2021 US$) where amounts are known` : 'amounts not reported'}.`];
    const top = [...records].filter((r) => r.amountUsd2021 !== null).sort((a, b) => b.amountUsd2021! - a.amountUsd2021!).slice(0, 3);
    if (top.length) lines.push(`Largest:\n${top.map((r) => `- ${recordTitle(r)}: ${formatUsd(r.amountUsd2021!)} (${r.commitmentYear ?? 'year n/a'}${r.lender ? `, ${r.lender}` : ''})`).join('\n')}`);
    return lines;
  }

  const projectLine = (p: Project) => `- **${p.name}** (${nameOfList(p.countries)}): ${STATUS_LABELS[p.status].toLowerCase()}${p.startYear ? `, started ${p.startYear}` : ''}${p.completionYear ? `, completed ${p.completionYear}` : ''}. ${p.cost.display}.`;
  const nameOfList = (isos: string[]) => list(isos.filter((c) => c !== 'CHN').map(nameOf)) || 'China';

  // ---- answers ------------------------------------------------------------------

  function aboutProject(p: Project): AskReply {
    const lines = [
      `**${p.name}**: ${p.subtype}, ${p.location}.`,
      `Status: **${STATUS_LABELS[p.status]}**${p.statusNote ? ` (${p.statusNote})` : ''}. ${p.startYear ? `Started ${p.startYear}` : 'Start year not reported'}${p.completionYear ? `, completed ${p.completionYear}` : ''}.`,
      `Cost: ${p.cost.display}.`,
      p.description,
    ];
    if (p.chineseEntities.length) lines.push(`Chinese entities: ${p.chineseEntities.join('; ')}.`);
    if (p.localPartners.length) lines.push(`Local partners: ${p.localPartners.join('; ')}.`);
    const corridors = data.corridors.filter((c) => p.corridors.includes(c.id)).map((c) => c.name);
    if (corridors.length) lines.push(`Corridor: ${corridors.join('; ')}.`);
    if (p.references.length) lines.push(`References: ${p.references.slice(0, 4).map((r) => `[${r.label}](${r.url})`).join(' · ')}`);
    lines.push(cite(p.sourceIds));
    return { reply: lines.join('\n\n'), actions: [{ action: 'focus_project', id: p.id }] };
  }

  function aboutCountry(iso3: string, type: ProjectType | null, status: ProjectStatus | null): AskReply {
    let projects = projectsIn(iso3);
    let records = recordsIn(iso3);
    if (type) {
      projects = projects.filter((p) => p.type === type);
      records = records.filter((r) => r.type === type);
    }
    if (status) projects = projects.filter((p) => p.status === status);
    const lines = [participationLine(iso3)];
    const label = type ? TYPE_PLURALS[type].toLowerCase() : 'flagship projects';
    if (projects.length) {
      lines.push(`**${type ? TYPE_PLURALS[type] : 'Flagship projects'} on the map${status ? ` (${STATUS_LABELS[status].toLowerCase()})` : ''}:**`);
      lines.push(projects.map(projectLine).join('\n'));
    } else {
      lines.push(`The site's curated sample has no ${status ? `${STATUS_LABELS[status].toLowerCase()} ` : ''}${label} in ${nameOf(iso3)}.`);
    }
    lines.push(...recordSummary(records));
    const eng = data.engagement.countries2025.values[iso3];
    if (eng !== undefined && !type) lines.push(`**${data.engagement.countries2025.measure}:** about ${usdBn(eng)} (GFDC estimate).`);
    const corridors = data.corridors.filter((c) => c.countries.includes(iso3)).map((c) => c.name);
    if (corridors.length && !type) lines.push(`Economic corridors: ${corridors.join('; ')}.`);
    const ids = ['gfdc-countries-2025', ...projects.flatMap((p) => p.sourceIds)];
    if (records.length) ids.push('aiddata-gcdf-v3');
    if (eng !== undefined && !type) ids.push(data.engagement.countries2025.sourceId);
    lines.push(cite(ids));
    const actions: MapAction[] = [{ action: 'focus_country', iso3 }];
    if (records.length && !projects.length) actions.push({ action: 'add_layers', layers: ['aiddata'] });
    return { reply: lines.join('\n\n'), actions };
  }

  function compareCountries(isos: string[]): AskReply {
    const rows = isos.slice(0, 5).map((iso) => {
      const st = computeRecordStats(recordsIn(iso), currentYear);
      const c = countryByIso.get(iso);
      const mou = !c ? 'not on the GFDC list' : participationAt(c, currentYear) === 'exited' ? `left in ${c.exitDate!.slice(0, 4)}` : c.mouDate ? `MoU ${c.mouDate.slice(0, 4)}` : 'MoU date unconfirmed';
      return `- **${nameOf(iso)}**: ${mou}; ${plural(projectsIn(iso).length, 'flagship project')} on the map; ${plural(st.count, 'AidData record')}${st.withAmount ? ` worth ${formatUsd(st.totalUsd)}` : ''}${data.engagement.countries2025.values[iso] !== undefined ? `; 2025 construction engagement about ${usdBn(data.engagement.countries2025.values[iso])}` : ''}.`;
    });
    return {
      reply: [`Comparing ${list(isos.slice(0, 5).map(nameOf))}:`, rows.join('\n'), 'AidData amounts are commitments in constant 2021 US$, 2000–2021.', cite(['gfdc-countries-2025', 'aiddata-gcdf-v3'])].join('\n\n'),
      actions: [{ action: 'focus_country', iso3: isos[0] }],
    };
  }

  function aboutCorridor(c: Corridor): AskReply {
    const projects = data.projects.filter((p) => p.corridors.includes(c.id));
    const lines = [`**${c.name}**: ${c.description}`, `Countries: ${nameOfList(c.countries)}.`];
    if (projects.length) lines.push(`Flagship projects on the map in this corridor:\n${projects.map(projectLine).join('\n')}`);
    lines.push(`${data.corridorsNote}`, cite(['ndrc-vision-2015', ...projects.flatMap((p) => p.sourceIds)]));
    return { reply: lines.join('\n\n'), actions: [{ action: 'add_layers', layers: ['corridors'] }] };
  }

  function ranking(q: string, type: ProjectType | null, region: string | null, lender: string | null, years: number[]): AskReply {
    let records = data.records;
    if (type) records = records.filter((r) => r.type === type);
    if (region) records = records.filter((r) => countryByIso.get(r.iso3)?.region === region);
    if (lender) records = records.filter((r) => r.lender === lender);
    const [from, to] = years.length >= 2 ? [Math.min(...years), Math.max(...years)] : years.length === 1 && /\b(since|after|from)\b/.test(q) ? [years[0], 9999] : years.length === 1 ? [years[0], years[0]] : [0, 9999];
    records = records.filter((r) => from === 0 || (r.commitmentYear !== null && r.commitmentYear >= from && r.commitmentYear <= to));
    const filters = [type ? TYPE_PLURALS[type].toLowerCase() : '', region ? `in ${region}` : '', lender ? `from ${lender}` : '', from ? (to === 9999 ? `since ${from}` : from === to ? `in ${from}` : `${from}–${to}`) : ''].filter(Boolean).join(', ');

    const byLender = /\b(lender|lenders|bank|banks|who lent|who lends|financier)/.test(q) && !lender;
    const sums = new Map<string, { total: number; n: number }>();
    for (const r of records) {
      const key = byLender ? (r.lender ?? 'Not stated') : r.iso3;
      const e = sums.get(key) ?? { total: 0, n: 0 };
      e.total += r.amountUsd2021 ?? 0;
      e.n += 1;
      sums.set(key, e);
    }
    const byCount = /\b(number|how many|count|projects)\b/.test(q);
    const top = [...sums].filter(([k]) => k !== '').sort((a, b) => (byCount ? b[1].n - a[1].n : b[1].total - a[1].total)).slice(0, 8);
    if (!top.length) return { reply: `No AidData records match ${filters || 'that'}.\n\n${cite(['aiddata-gcdf-v3'])}`, actions: [] };
    const rows = top.map(([k, v], i) => `${i + 1}. **${byLender ? k : nameOf(k)}**: ${formatUsd(v.total)} across ${plural(v.n, 'record')}`);
    const reply = [
      `${byLender ? 'Largest Chinese lenders' : 'Countries receiving the most Chinese official finance'} in the AidData records${filters ? ` (${filters})` : ''}, by ${byCount ? 'number of records' : 'amount committed'}:`,
      rows.join('\n'),
      `These are ${records.length.toLocaleString('en-US')} geolocated infrastructure records from AidData's GCDF v3 (2000–2021, constant 2021 US$), not all Chinese lending.`,
      cite(['aiddata-gcdf-v3']),
    ].join('\n\n');
    const actions: MapAction[] = [{ action: 'add_layers', layers: ['aiddata'] }];
    if (!byLender) actions.unshift({ action: 'focus_country', iso3: top[0][0] });
    return { reply, actions };
  }

  function participation(q: string, region: string | null, year: number | null): AskReply {
    const y = year ?? currentYear;
    const pool = data.participation.filter((c) => !region || c.region === region);
    const status = (c: ParticipationCountry) => participationAt(c, y);
    const signed = pool.filter((c) => status(c) === 'participant');
    const exited = pool.filter((c) => status(c) === 'exited');
    const unconfirmed = pool.filter((c) => status(c) === 'unconfirmed');
    const lines = [
      `By ${year ? `the end of ${y}` : 'the latest data'}, **${signed.length}** ${region ? `countries in ${region}` : 'countries'} had a dated Belt and Road MoU, according to GFDC (Fudan University). ${unconfirmed.length ? `${plural(unconfirmed.length, 'more country', 'more countries')} ${unconfirmed.length === 1 ? 'is' : 'are'} on the list without a confirmed MoU date.` : ''}`,
    ];
    if (exited.length) lines.push(`Left the initiative: ${exited.map((c) => `${c.name} (${c.exitDate!.slice(0, 4)})`).join(', ')}.`);
    if (/\b(joined|signed|new)\b/.test(q) && year) {
      const joined = pool.filter((c) => c.mouDate?.startsWith(String(year)));
      lines.push(joined.length ? `Signed in ${year}: ${joined.map((c) => c.name).join(', ')}.` : `No country ${region ? `in ${region} ` : ''}signed in ${year}.`);
    }
    if (!region) {
      const byRegion = new Map<string, number>();
      for (const c of signed) byRegion.set(c.region, (byRegion.get(c.region) ?? 0) + 1);
      lines.push([...byRegion].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${r}: ${n}`).join('\n'));
    }
    lines.push(data.participationNote, cite(['gfdc-countries-2025']));
    return { reply: lines.join('\n\n'), actions: year ? [{ action: 'set_year', year }, { action: 'add_layers', layers: ['participants'] }] : [{ action: 'add_layers', layers: ['participants'] }] };
  }

  function engagement(): AskReply {
    const e = data.engagement;
    const lines = [
      `GFDC estimates Chinese construction contracts and investment in BRI countries (${e.meta.unit}):`,
      e.periods.map((p) => `- **${p.period}**: ${p.total} total (${p.construction} construction, ${p.investment} investment), ${p.deals} deals. ${p.change}.`).join('\n'),
      e.cumulative.map((c) => `- Cumulative to ${c.asOf}: about US$${c.total.toLocaleString('en-US')} billion.`).join('\n'),
      `**2025 highlights:** ${e.highlights2025.map((h) => `${h.label} US$${h.value} bn (${h.note})`).join('; ')}.`,
      `**${e.official.label}:** ${e.official.items.map((i) => `${i.label}: US$${i.value} bn (${i.note})`).join('; ')}. ${e.official.note}`,
      e.meta.note,
      cite([...e.meta.sourceIds, e.official.sourceId]),
    ];
    return { reply: lines.join('\n\n'), actions: [] };
  }

  function aboutRegion(region: string, type: ProjectType | null, status: ProjectStatus | null): AskReply {
    const isos = new Set(data.participation.filter((c) => c.region === region).map((c) => c.iso3));
    let projects = data.projects.filter((p) => p.countries.some((c) => isos.has(c)));
    let records = data.records.filter((r) => isos.has(r.iso3));
    if (type) {
      projects = projects.filter((p) => p.type === type);
      records = records.filter((r) => r.type === type);
    }
    if (status) projects = projects.filter((p) => p.status === status);
    const signed = data.participation.filter((c) => isos.has(c.iso3) && participationAt(c, currentYear) === 'participant').length;
    const lines = [`**${region}**: ${signed} countries with a dated Belt and Road MoU (GFDC).`];
    lines.push(projects.length ? `**${type ? TYPE_PLURALS[type] : 'Flagship projects'} on the map:**\n${projects.map(projectLine).join('\n')}` : `No ${type ? TYPE_PLURALS[type].toLowerCase() : 'flagship projects'} from the curated sample in this region.`);
    lines.push(...recordSummary(records));
    lines.push(cite(['gfdc-countries-2025', 'aiddata-gcdf-v3', ...projects.flatMap((p) => p.sourceIds)]));
    return { reply: lines.join('\n\n'), actions: type ? [{ action: 'add_layers', layers: [type, 'aiddata'] }] : [] };
  }

  function aboutType(type: ProjectType, status: ProjectStatus | null): AskReply {
    const projects = data.projects.filter((p) => p.type === type && (!status || p.status === status));
    const lines = [
      projects.length
        ? `**${TYPE_PLURALS[type]}${status ? ` (${STATUS_LABELS[status].toLowerCase()})` : ''} in the curated sample:**\n${projects.map(projectLine).join('\n')}`
        : `No ${status ? `${STATUS_LABELS[status].toLowerCase()} ` : ''}${TYPE_PLURALS[type].toLowerCase()} in the curated sample.`,
      ...recordSummary(data.records.filter((r) => r.type === type)),
      cite(['aiddata-gcdf-v3', ...projects.flatMap((p) => p.sourceIds)]),
    ];
    return { reply: lines.join('\n\n'), actions: [{ action: 'add_layers', layers: [type] }] };
  }

  function aboutYear(year: number): AskReply {
    const started = data.projects.filter((p) => p.startYear === year);
    const finished = data.projects.filter((p) => p.completionYear === year);
    const joined = data.participation.filter((c) => c.mouDate?.startsWith(String(year)));
    const recs = data.records.filter((r) => r.commitmentYear === year);
    const total = recs.reduce((s, r) => s + (r.amountUsd2021 ?? 0), 0);
    const lines = [`**${year}** on the map:`];
    lines.push(`- Countries signing a Belt and Road MoU: ${joined.length ? joined.map((c) => c.name).join(', ') : 'none recorded'}.`);
    if (started.length) lines.push(`- Flagship projects started: ${started.map((p) => p.name).join('; ')}.`);
    if (finished.length) lines.push(`- Flagship projects completed: ${finished.map((p) => p.name).join('; ')}.`);
    lines.push(recs.length ? `- AidData records committed: ${recs.length}${total ? ` (${formatUsd(total)})` : ''}.` : year > 2021 ? '- AidData records end in 2021.' : '- No AidData records committed that year.');
    lines.push('I moved the timeline to that year.', cite(['gfdc-countries-2025', 'aiddata-gcdf-v3']));
    return { reply: lines.join('\n'), actions: [{ action: 'set_year', year }] };
  }

  function help(): AskReply {
    return {
      reply: [
        'I answer from the data on this site, using simple rules rather than AI, so I work best with short questions that name a country, project, corridor, region, sector or year. For example:',
        '- "Tell me about Kenya" or "railways in Indonesia"\n- "Which countries received the most Chinese loans for energy?"\n- "Which banks lent the most in Africa since 2015?"\n- "Compare Pakistan and Bangladesh"\n- "What is CPEC?" or "Hambantota port"\n- "How many countries had joined by 2017?"\n- "How has BRI investment changed?"',
        `The data: ${data.participation.length} countries on the GFDC list, ${data.projects.length} curated flagship projects, ${data.records.length.toLocaleString('en-US')} AidData finance records and GFDC's 2025–26 engagement estimates. See the Sources section for details.`,
      ].join('\n\n'),
      actions: [],
    };
  }

  function search(q: string): AskReply | null {
    const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !GENERIC_NAME_WORDS.has(w) && !['what', 'which', 'tell', 'about', 'show', 'where', 'there', 'with', 'does', 'have', 'from', 'china', 'chinese', 'many', 'much'].includes(w));
    if (!words.length) return null;
    const projects = data.projects.filter((p) => words.some((w) => norm(`${p.name} ${p.location} ${p.chineseEntities.join(' ')}`).includes(w)));
    const records = data.records.filter((r) => words.every((w) => norm(r.title).includes(w))).slice(0, 5);
    if (!projects.length && !records.length) return null;
    const lines = [`I couldn't match that to a single answer, but these mention "${words.join(' ')}":`];
    if (projects.length) lines.push(projects.slice(0, 6).map(projectLine).join('\n'));
    if (records.length) lines.push(records.map((r) => `- ${recordTitle(r)} (${nameOf(r.iso3)}, ${r.commitmentYear ?? 'year n/a'}${r.amountUsd2021 ? `, ${formatUsd(r.amountUsd2021)}` : ''})`).join('\n'));
    lines.push(cite([...(records.length ? ['aiddata-gcdf-v3'] : []), ...projects.flatMap((p) => p.sourceIds)]));
    const actions: MapAction[] = projects.length === 1 ? [{ action: 'focus_project', id: projects[0].id }] : records.length === 1 && !projects.length ? [{ action: 'focus_record', id: records[0].id }] : [];
    return { reply: lines.join('\n\n'), actions };
  }

  return {
    answer(question: string, context: AskContext = { countries: [], projects: [] }) {
      const q = ` ${norm(question).replace(/[–—]/g, '-')} `;
      let countries = matcher.find(question);
      let projects = findProjects(q);
      const corridor = data.corridors.find((c) => has(q, CORRIDOR_WORDS[c.id] ?? []) || q.includes(norm(c.name)));
      const region = REGION_WORDS.find(([, w]) => has(q, w))?.[0] ?? null;
      const type = (Object.keys(TYPE_WORDS) as ProjectType[]).find((t) => has(q, TYPE_WORDS[t])) ?? null;
      const status = STATUS_WORDS.find(([, w]) => has(q, w))?.[0] ?? null;
      const lender = LENDER_WORDS.find(([, w]) => has(q, w))?.[0] ?? null;
      const years = unique([...q.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1])));
      // Follow-ups: "its", "there", "that country" refer to the last answer.
      if (!countries.length && !projects.length && !corridor && /\b(its|it|there|that country|this country|they|their)\b/.test(q)) {
        if (context.projects.length) projects = data.projects.filter((p) => p.id === context.projects[0]);
        else countries = context.countries.slice(0, 1);
      }
      // A country named as part of a project ("Laos-China Railway") is the project's.
      if (projects.length === 1) countries = countries.filter((c) => !projects[0].countries.includes(c));

      const done = (r: AskReply) => ({ ...r, context: { countries: countries.length ? countries : context.countries, projects: projects.length ? projects.map((p) => p.id) : countries.length ? [] : context.projects } });

      if (/^\s*(hi|hello|hey|help|what can you|how do (i|you)|what do you know|what data)\b/.test(q.trim()) || has(q, ['what can you do', 'what can i ask', 'which data', 'your sources', 'where does the data'])) return done(help());
      if (has(q, ['compare', 'comparing', 'vs', 'versus', 'difference between']) && countries.length >= 2) return done(compareCountries(countries));
      const rankingQ = has(q, ['most', 'largest', 'biggest', 'top', 'highest', 'rank', 'ranking', 'leading']);
      const financeQ = has(q, ['loan', 'loans', 'lend', 'lending', 'lent', 'finance', 'financing', 'money', 'funding', 'funded', 'grant', 'grants', 'debt', 'lender', 'lenders', 'bank', 'banks', 'aiddata']) || lender !== null;
      if (rankingQ && (financeQ || /\b(countries|country|recipient|recipients)\b/.test(q)) && countries.length === 0) return done(ranking(q, type, region, lender, years));
      if (has(q, ['engagement', 'investment report', 'gfdc', 'how much investment', 'investment changed', 'construction contracts', 'trend', 'changed since', 'over time']) && !countries.length && !projects.length) return done(engagement());
      if (corridor && !projects.length) return done(aboutCorridor(corridor));
      if (projects.length === 1) return done(aboutProject(projects[0]));
      if (countries.length >= 2 && !projects.length) return done(compareCountries(countries));
      if (countries.length === 1) return done(aboutCountry(countries[0], type, status));
      if (projects.length > 1) {
        return done({
          reply: `Several projects match. Which one did you mean?\n\n${projects.map(projectLine).join('\n')}`,
          actions: [],
        });
      }
      const membership = has(q, ['how many countries', 'members', 'member', 'joined', 'signed', 'participants', 'participating', 'left', 'exited', 'withdrew', 'mou']);
      if (membership) return done(participation(q, region, years[0] ?? null));
      if (financeQ && (region || type || lender || years.length)) return done(ranking(q, type, region, lender, years));
      if (region) return done(aboutRegion(region, type, status));
      if (type) return done(aboutType(type, status));
      if (years.length === 1) return done(aboutYear(years[0]));
      if (has(q, ['belt and road', 'bri', 'silk road'])) {
        return done({
          reply: [
            'The Belt and Road Initiative (BRI) is China\'s programme, announced in 2013, to finance and build infrastructure and deepen trade links: the land-based "Silk Road Economic Belt" and the sea-based "21st Century Maritime Silk Road".',
            `On this site: ${data.participation.length} countries on the GFDC list, ${data.projects.length} curated flagship projects, the six economic corridors from the 2015 Vision and Actions document, and ${data.records.length.toLocaleString('en-US')} AidData finance records. Ask about any country, project or sector to see more.`,
            cite(['ndrc-vision-2015', 'gfdc-countries-2025', 'aiddata-gcdf-v3']),
          ].join('\n\n'),
          actions: [],
        });
      }
      const found = search(q);
      if (found) return done(found);
      return done({
        reply: "Sorry, I couldn't match that to the site's data. I work best with questions that name a country, project, corridor, region, sector or year, for example \"Tell me about Kenya\" or \"Which countries received the most Chinese loans for ports?\". Type **help** for more examples.",
        actions: [],
      });
    },
  };
}
