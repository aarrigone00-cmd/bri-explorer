import { fetchWithTimeout } from '../http';
import { adminClient } from '../supabase';
import { finishRun, startRun } from '../runs';
import { describeError } from '../errors';
import { buildDigest } from './digest';
import { FEEDS, type Feed } from './feeds';
import { parseFeed, type FeedItem } from './rss';

// Agent 4, "China & the World": reads the RSS feeds in parallel, builds the
// digest with keyword rules and publishes it. Fits in a scheduled function's
// 30-second limit (each feed gets at most 8 seconds).

const FEED_TIMEOUT_MS = 8000;

async function readFeed(feed: Feed): Promise<FeedItem[]> {
  const res = await fetchWithTimeout(feed.url, FEED_TIMEOUT_MS, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

export interface NewsRunResult {
  digestId: string;
  stories: number;
  outlets: number;
  failed: string[];
}

export async function runNews(triggeredBy: string): Promise<NewsRunResult> {
  const db = adminClient();
  const runId = await startRun('news', triggeredBy);
  try {
    const settled = await Promise.allSettled(FEEDS.map(readFeed));
    const results: { feed: Feed; items: FeedItem[] }[] = [];
    const failed: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') results.push({ feed: FEEDS[i], items: s.value });
      else {
        failed.push(FEEDS[i].publisher);
        console.warn(`Feed failed: ${FEEDS[i].url} (${s.reason instanceof Error ? s.reason.message : String(s.reason)})`);
      }
    });
    if (!results.length) throw new Error('No news feed could be read.');

    const digest = buildDigest(results);
    if (!digest.items.length) throw new Error('The feeds had no China foreign-policy stories from the past week.');
    const { data, error } = await db
      .from('news_digests')
      .insert({
        status: 'ready',
        overview: digest.overview,
        items: digest.items,
        search_count: results.length,
        model: 'rss-rules',
        run_id: runId,
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    const out = { digestId: data.id as string, stories: digest.items.length, outlets: results.length, failed };
    await finishRun(runId, 'succeeded', { ...out });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : describeError(err).message;
    await finishRun(runId, 'failed', { error: message });
    throw err;
  }
}
