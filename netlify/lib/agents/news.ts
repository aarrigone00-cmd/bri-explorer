import type Anthropic from '@anthropic-ai/sdk';
import { AgentError, type MessagesClient } from '../anthropic';
import { countryByIso } from '../data';
import { runToolLoop } from '../loop';
import { clip, recordingClient, verifiedSources, webSearchTool, type SourceRef } from '../web';

// "China & the World": a daily, cited digest of news about China's foreign policy.

export const NEWS_TOPICS = ['Belt and Road & development finance', 'Diplomacy', 'Trade & economy', 'Security', 'Global governance', 'Technology & standards'] as const;

export interface DigestItem {
  headline: string;
  date: string;
  summary: string;
  why_it_matters: string;
  perspectives: string;
  topic: (typeof NEWS_TOPICS)[number];
  countries: string[];
  bri_related: boolean;
  sources: SourceRef[];
}

export interface Digest {
  overview: string;
  items: DigestItem[];
  searches: number;
}

const PUBLISH_TOOL: Anthropic.Beta.BetaTool = {
  name: 'publish_digest',
  description: 'Publish the finished digest. Call exactly once, after researching. Every item needs at least one source URL taken from your web search results.',
  input_schema: {
    type: 'object',
    properties: {
      overview: { type: 'string', description: '2–3 neutral sentences summarising the main themes of the period.' },
      items: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            headline: { type: 'string', description: 'Factual headline, max ~15 words.' },
            date: { type: 'string', description: 'Date of the event or report, YYYY-MM-DD.' },
            summary: { type: 'string', description: '2–3 sentences: what happened, who, where.' },
            why_it_matters: { type: 'string', description: 'One sentence of context.' },
            perspectives: { type: 'string', description: 'How the main parties describe it (e.g. Chinese officials vs. counterparts or critics), attributed. Empty if not applicable.' },
            topic: { type: 'string', enum: [...NEWS_TOPICS] },
            countries: { type: 'array', items: { type: 'string' }, description: 'ISO 3166-1 alpha-3 codes of countries involved (excluding China).' },
            bri_related: { type: 'boolean', description: 'True if directly about the Belt and Road Initiative or Chinese overseas infrastructure/finance.' },
            sources: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: {
                type: 'object',
                properties: { url: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' } },
                required: ['url', 'title', 'publisher'],
              },
            },
          },
          required: ['headline', 'date', 'summary', 'why_it_matters', 'perspectives', 'topic', 'countries', 'bri_related', 'sources'],
        },
      },
    },
    required: ['overview', 'items'],
  },
};

function systemPrompt(today: string) {
  return `You are the news editor of BRI Explorer, an educational website about China's Belt and Road Initiative. Today is ${today}.

Task: research and publish a digest of the most significant news about China's foreign policy from roughly the last 7 days.

Research:
- Use web search. Cover a range of regions and topics: diplomacy and leader visits, the Belt and Road and Chinese development finance, trade, security, global governance (UN, BRICS, SCO, G20) and technology/standards.
- Prefer established news organisations and wire services from different countries and regions, and official statements (China's Ministry of Foreign Affairs and the governments involved). Use at least two independent outlets for contested claims.
- Only include events you found in your search results, with dates inside the period. Skip anything you cannot source.

Writing:
- Be neutral and factual. Attribute claims and characterisations ("Beijing said…", "critics argue…", "the government of X stated…"). Do not editorialise, speculate, or adopt any side's framing as fact.
- Choose 5–8 items, most significant first. Mark items about the Belt and Road or Chinese overseas infrastructure/finance with bri_related.
- Finish by calling publish_digest exactly once. Every source URL must come from your web search results.`;
}

export async function runNewsDigest(inner: MessagesClient, today = new Date().toISOString().slice(0, 10)): Promise<Digest> {
  const { client, seen, searchCount } = recordingClient(inner);
  let published = null as Digest | null;
  let rejection = '';

  await runToolLoop(client, {
    system: systemPrompt(today),
    messages: [{ role: 'user', content: `Prepare the China foreign policy news digest for the week ending ${today}.` }],
    tools: [webSearchTool(8), PUBLISH_TOOL],
    effort: 'medium',
    maxTokens: 16000,
    maxRounds: 12,
    timeBudgetMs: 10 * 60_000, // runs in a background function (15 min limit)
    runTool: (name, input) => {
      if (name !== 'publish_digest') return { error: `Unknown tool ${name}` };
      const items: DigestItem[] = [];
      for (const raw of Array.isArray(input.items) ? input.items.slice(0, 8) : []) {
        const it = raw as Record<string, unknown>;
        const sources = verifiedSources(it.sources, seen);
        if (!sources.length) continue; // drop items whose links weren't in search results
        const topic = NEWS_TOPICS.includes(it.topic as DigestItem['topic']) ? (it.topic as DigestItem['topic']) : 'Diplomacy';
        items.push({
          headline: clip(it.headline, 200),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(it.date)) ? String(it.date) : '',
          summary: clip(it.summary, 800),
          why_it_matters: clip(it.why_it_matters, 400),
          perspectives: clip(it.perspectives, 600),
          topic,
          countries: (Array.isArray(it.countries) ? it.countries : [])
            .map((c) => String(c).toUpperCase())
            .filter((c) => countryByIso.has(c) || /^[A-Z]{3}$/.test(c))
            .slice(0, 8),
          bri_related: it.bri_related === true,
          sources,
        });
      }
      if (items.length < 3) {
        rejection = `Only ${items.length} item(s) had sources from your search results.`;
        return { error: `${rejection} Use URLs exactly as returned by web_search, research more if needed, and call publish_digest again.` };
      }
      published = { overview: clip(input.overview, 800), items, searches: searchCount() };
      return { ok: true, published_items: items.length, note: 'Published. You are done; reply with one short sentence.' };
    },
  });

  if (!published) throw new AgentError(`The news agent did not produce a digest. ${rejection}`.trim(), 502);
  return published;
}
