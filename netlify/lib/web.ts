import type Anthropic from '@anthropic-ai/sdk';
import type { MessagesClient } from './anthropic';

/** Current dated web search tool (dynamic filtering; Opus 4.6+ / Sonnet 4.6+). */
export function webSearchTool(maxUses: number): Anthropic.Beta.BetaWebSearchTool20260209 {
  return { type: 'web_search_20260209', name: 'web_search', max_uses: maxUses };
}

export interface SourceRef {
  url: string;
  title: string;
  publisher: string;
}

/** Wraps a client to record every URL returned by web search during a run. */
export function recordingClient(inner: MessagesClient) {
  const seen = new Map<string, { title: string; pageAge: string | null }>();
  let searches = 0;
  const client: MessagesClient = {
    async create(params) {
      const res = await inner.create(params);
      for (const block of res.content) {
        if (block.type === 'server_tool_use' && block.name === 'web_search') searches += 1;
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) seen.set(canonical(r.url), { title: r.title, pageAge: r.page_age });
        }
        if (block.type === 'text') {
          for (const c of block.citations ?? []) {
            if (c.type === 'web_search_result_location' && !seen.has(canonical(c.url))) seen.set(canonical(c.url), { title: c.title ?? '', pageAge: null });
          }
        }
      }
      return res;
    },
  };
  return { client, seen, searchCount: () => searches };
}

export function canonical(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    return `${u.protocol}//${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

const publisherFrom = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Keeps only sources the model actually saw in search results (no invented
 * links) and normalises them. Returns at most `max` unique sources.
 */
export function verifiedSources(raw: unknown, seen: Map<string, unknown>, max = 4): SourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SourceRef[] = [];
  const keys = new Set<string>();
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const url = typeof (s as { url?: unknown }).url === 'string' ? (s as { url: string }).url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const key = canonical(url);
    if (!seen.has(key) || keys.has(key)) continue;
    keys.add(key);
    const title = String((s as { title?: unknown }).title ?? '').slice(0, 300) || url;
    const publisher = String((s as { publisher?: unknown }).publisher ?? '').slice(0, 100) || publisherFrom(url);
    out.push({ url, title, publisher });
    if (out.length >= max) break;
  }
  return out;
}

export const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
