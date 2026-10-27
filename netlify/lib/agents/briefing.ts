import type { Profile } from '../../../src/types';
import { textOf, type MessagesClient } from '../anthropic';
import { countryName, projectById, recordById, recordShortTitle } from '../data';
import { runToolLoop } from '../loop';
import { DATA_TOOLS, runDataTool } from '../site-tools';
import type { DigestItem } from './news';

// "My Briefing": a personal one-page briefing built from the user's profile
// (region of interest, saved countries/projects/records), the site's data and
// the latest cited news digest. No web search, so it stays fast and grounded.

const SYSTEM = `You write short personal briefings for users of BRI Explorer, an educational map of China's Belt and Road Initiative (BRI).

Use the data tools to look up every figure, date and status you mention; never estimate or use numbers from memory. You may also use the recent news items you are given, citing them as "(news digest, <publisher>)". Name the data source for figures, e.g. "(AidData GCDF v3)", "(GFDC list)", "(Nedopil 2026, preliminary)". The datasets measure different things, so never add them together.

Write neutrally, for an educated general reader. Format in Markdown with exactly these sections:
## At a glance
(2–3 sentences tailored to the user's interests)
## Your saved items
(one bullet per saved item, max 8, each with the most useful facts; if none, suggest 2–3 things worth saving in their region)
## Your region
(key BRI facts for their region of interest; if none set, pick the region most connected to their saved items)
## In the news
(1–3 relevant items from the news digest, if any are relevant; otherwise write "No recent digest items match your interests.")
## Explore next
(2–3 concrete suggestions of what to look at on the map)

Keep it under 450 words.`;

function describeSaved(profile: Profile): string[] {
  return profile.saved_items.slice(0, 12).map((s) => {
    if (s.kind === 'country') return `Country: ${countryName(s.id)} (iso3 ${s.id})`;
    if (s.kind === 'project') return `Flagship project: ${projectById.get(s.id)?.name ?? s.id} (id ${s.id})`;
    const r = recordById.get(Number(s.id));
    return `AidData record #${s.id}: ${r ? `${recordShortTitle(r)}, ${countryName(r.iso3)}` : 'unknown'}`;
  });
}

export async function runBriefing(client: MessagesClient, profile: Profile, news: DigestItem[]): Promise<{ markdown: string; truncated: boolean }> {
  const saved = describeSaved(profile);
  const newsLines = news.slice(0, 8).map(
    (n) => `- ${n.date} | ${n.headline} | ${n.summary} | countries: ${n.countries.join(', ') || 'n/a'} | source: ${n.sources[0]?.publisher ?? ''}`,
  );
  const user = [
    `Write my briefing.`,
    `Name: ${profile.display_name || 'not set'}`,
    `Organization: ${profile.affiliation || 'not set'}`,
    `Region of interest: ${profile.region_of_interest || 'not set'}`,
    `About me: ${profile.bio || 'not set'}`,
    `Saved items:\n${saved.length ? saved.map((s) => `- ${s}`).join('\n') : '- none'}`,
    `Recent news digest:\n${newsLines.length ? newsLines.join('\n') : '- no digest available yet'}`,
  ].join('\n\n');

  const result = await runToolLoop(client, {
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    tools: DATA_TOOLS,
    effort: 'medium',
    maxTokens: 6000,
    maxRounds: 8,
    timeBudgetMs: 40_000,
    runTool: (name, input) => runDataTool(name, input),
  });
  return { markdown: textOf(result.final), truncated: result.truncated };
}
