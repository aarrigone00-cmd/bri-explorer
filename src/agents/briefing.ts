// Agent 3, "My Briefing": a one-page briefing assembled in the browser from the
// user's profile (region of interest, saved items), the site's datasets, the
// latest news digest and approved project updates. Template-written, no AI.
import { computeRecordStats, formatUsd, participationAt, yearRange } from '../lib/analytics';
import { STATUS_LABELS } from '../labels';
import type { Dataset, FinanceRecord, Profile, ProjectUpdate } from '../types';

export interface BriefingNewsItem {
  headline: string;
  date: string;
  topic: string;
  countries: string[];
  bri_related: boolean;
  sources: { url: string; publisher: string }[];
}

export interface BriefingInput {
  data: Dataset;
  profile: Pick<Profile, 'display_name' | 'region_of_interest' | 'saved_items'> | null;
  news: BriefingNewsItem[];
  updates: Record<string, ProjectUpdate>;
  now?: Date;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Returns safe Markdown for renderMarkdown. */
export function buildBriefing({ data, profile, news, updates, now = new Date() }: BriefingInput): string {
  const year = yearRange(data).max;
  const byIso = new Map(data.participation.map((c) => [c.iso3, c]));
  const names = new Map<string, string>();
  for (const f of data.world.features) if (f.properties.iso3) names.set(f.properties.iso3, f.properties.name);
  for (const c of data.participation) names.set(c.iso3, c.name);
  const nameOf = (iso: string) => names.get(iso) ?? iso;
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const recordById = new Map(data.records.map((r) => [String(r.id), r]));
  const recordsIn = (isos: Set<string>) => data.records.filter((r) => isos.has(r.iso3));
  const md: string[] = [];

  const region = profile?.region_of_interest && profile.region_of_interest !== 'Global' ? profile.region_of_interest : null;
  const saved = profile?.saved_items ?? [];

  // ---- At a glance ---------------------------------------------------------------
  const participants = data.participation.filter((c) => participationAt(c, year) === 'participant').length;
  const latest = data.engagement.periods[data.engagement.periods.length - 1];
  md.push(`## Briefing${profile?.display_name ? ` for ${profile.display_name}` : ''}, ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`);
  md.push('### At a glance');
  md.push(
    [
      `- **${participants}** countries with a dated Belt and Road MoU (GFDC, Fudan University).`,
      `- **${data.projects.length}** curated flagship projects and **${data.records.length.toLocaleString('en-US')}** AidData finance records on the map.`,
      latest ? `- Latest GFDC estimate: US$${latest.total} billion of Chinese construction and investment engagement in ${latest.period} (${latest.change.split(';')[0]}).` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // ---- Saved items ---------------------------------------------------------------
  const watchedCountries = new Set<string>();
  if (saved.length) {
    md.push('### Your saved items');
    const lines: string[] = [];
    for (const item of saved.slice(0, 12)) {
      if (item.kind === 'country') {
        const c = byIso.get(item.id);
        const st = computeRecordStats(recordsIn(new Set([item.id])), year);
        const projects = data.projects.filter((p) => p.countries.includes(item.id)).length;
        const status = !c ? 'not on the GFDC list' : participationAt(c, year) === 'exited' ? `left the BRI in ${c.exitDate!.slice(0, 4)}` : c.mouDate ? `MoU ${c.mouDate.slice(0, 4)}` : 'MoU date unconfirmed';
        lines.push(`- **${nameOf(item.id)}**: ${status}; ${plural(projects, 'flagship project')}; ${plural(st.count, 'AidData record')}${st.withAmount ? ` (${formatUsd(st.totalUsd)})` : ''}.`);
        watchedCountries.add(item.id);
      } else if (item.kind === 'project') {
        const p = projectById.get(item.id);
        if (!p) continue;
        const u = updates[p.id];
        lines.push(`- **${p.name}**: ${STATUS_LABELS[p.status].toLowerCase()}. ${p.cost.display}.${u ? ` *Update (${u.as_of ?? u.reviewed_at?.slice(0, 10) ?? ''}): ${u.status_note ?? STATUS_LABELS[u.suggested_status]}*` : ''}`);
        for (const c of p.countries) if (c !== 'CHN') watchedCountries.add(c);
      } else {
        const r = recordById.get(item.id);
        if (!r) continue;
        lines.push(`- **${shortTitle(r)}** (${nameOf(r.iso3)}): ${r.amountUsd2021 ? formatUsd(r.amountUsd2021) : 'amount not reported'}, committed ${r.commitmentYear ?? 'year n/a'}${r.lender ? ` by ${r.lender}` : ''}.`);
        watchedCountries.add(r.iso3);
      }
    }
    md.push(lines.join('\n'));
  } else {
    md.push('### Your saved items');
    md.push('You have no saved items yet. Open a country, project or finance record on the map and press **Save** to follow it here.');
  }

  // ---- Region --------------------------------------------------------------------
  const regionIsos = new Set(data.participation.filter((c) => !region || c.region === region).map((c) => c.iso3));
  const regionRecords = region ? recordsIn(regionIsos) : data.records;
  const st = computeRecordStats(regionRecords, year);
  md.push(`### ${region ?? 'Worldwide'}`);
  const regionProjects = data.projects.filter((p) => !region || p.countries.some((c) => regionIsos.has(c)));
  const signed = data.participation.filter((c) => regionIsos.has(c.iso3) && participationAt(c, year) === 'participant').length;
  const building = regionProjects.filter((p) => p.status === 'under-construction' || p.status === 'planned' || p.status === 'partially-operational');
  md.push(
    [
      region ? `- ${signed} countries with a dated MoU in ${region}.` : '',
      `- ${plural(regionProjects.length, 'flagship project')} on the map${building.length ? `, ${building.length} of them not yet complete: ${building.map((p) => p.name).join('; ')}` : ''}.`,
      `- AidData: ${plural(st.count, 'record')} worth ${formatUsd(st.totalUsd)} (2000–2021). Largest recipients: ${st.topCountries
        .slice(0, 3)
        .map(([iso, v]) => `${nameOf(iso)} (${formatUsd(v)})`)
        .join(', ')}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (!profile?.region_of_interest) md.push('*Tip: choose a region of interest in your profile to focus this section.*');

  // ---- News ----------------------------------------------------------------------
  if (news.length) {
    const relevant = news.filter((n) => n.countries.some((c) => watchedCountries.has(c) || (region && regionIsos.has(c))));
    const pick = (relevant.length ? relevant : news.filter((n) => n.bri_related).concat(news)).filter((n, i, a) => a.indexOf(n) === i).slice(0, 4);
    md.push(`### In the news${relevant.length ? ' for your countries and region' : ' this week'}`);
    md.push(pick.map((n) => `- ${n.headline} (${n.sources.map((s) => `[${s.publisher}](${s.url})`).join(', ')}, ${n.date})`).join('\n'));
  }

  // ---- Explore next --------------------------------------------------------------
  const ideas: string[] = [];
  const unsavedTop = st.topCountries.map(([iso]) => iso).find((iso) => !watchedCountries.has(iso));
  if (unsavedTop) ideas.push(`- **${nameOf(unsavedTop)}**: the largest AidData recipient ${region ? `in ${region} ` : ''}you aren't following yet.`);
  const corridor = data.corridors.find((c) => c.countries.some((iso) => watchedCountries.has(iso) || (region && regionIsos.has(iso))));
  if (corridor) ideas.push(`- The **${corridor.name}**: turn on the corridors layer to see it.`);
  const unsavedProject = building.find((p) => !saved.some((s) => s.kind === 'project' && s.id === p.id));
  if (unsavedProject) ideas.push(`- **${unsavedProject.name}** (${STATUS_LABELS[unsavedProject.status].toLowerCase()}): save it to follow updates from the Project Watcher.`);
  if (ideas.length) {
    md.push('### Explore next');
    md.push(ideas.join('\n'));
  }

  md.push('*Written from the site\'s data: GFDC country list and engagement reports, AidData GCDF v3, the curated project sample, and the weekly news digest. See Sources for details.*');
  return md.join('\n\n');
}

function shortTitle(r: FinanceRecord): string {
  const m = r.title.match(/\bfor (?:the )?(.+)$/i);
  const t = (m ? m[1] : r.title).replace(/\s*\((?:linked|Linked)[^)]*\)?\s*$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
