// GDELT DOC 2.0 API: a free, keyless index of world news coverage.
// https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// GDELT asks for at most one request every 5 seconds.
import { fetchWithTimeout } from '../http';
import type { Article } from './detect';

export const GDELT_SPACING_MS = 5500;

export class GdeltError extends Error {
  constructor(readonly status: number) {
    super(`GDELT HTTP ${status}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
}

export function parseGdelt(body: string): Article[] {
  let parsed: { articles?: GdeltArticle[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    // GDELT answers some bad queries with a plain-text message.
    throw new Error(`GDELT: ${body.slice(0, 120).trim() || 'empty response'}`);
  }
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of parsed.articles ?? []) {
    if (!a.url || !a.title || !/^https?:\/\//i.test(a.url) || seen.has(a.url)) continue;
    seen.add(a.url);
    const d = a.seendate?.match(/^(\d{4})(\d{2})(\d{2})/);
    out.push({ url: a.url, title: a.title.replace(/\s+/g, ' ').trim(), domain: a.domain ?? new URL(a.url).hostname, date: d ? `${d[1]}-${d[2]}-${d[3]}` : '' });
  }
  return out;
}

/** English-language articles from the past two weeks, newest first. */
export async function searchGdelt(query: string, max = 25): Promise<Article[]> {
  const params = new URLSearchParams({
    query: `${query} sourcelang:english`,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(max),
    timespan: '14d',
    sort: 'datedesc',
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;
  // Back off and retry when GDELT says we're going too fast.
  const backoff = [12000, 30000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, 20000);
    if (res.status === 429 && attempt < backoff.length) {
      await sleep(backoff[attempt]);
      continue;
    }
    if (!res.ok) throw new GdeltError(res.status);
    return parseGdelt(await res.text());
  }
}

export { sleep };
