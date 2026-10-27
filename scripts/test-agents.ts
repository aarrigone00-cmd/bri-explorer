// Offline tests for the four free agents: RSS parsing and the news digest
// rules, the Project Watcher's GDELT rules, the Ask the Map engine and the
// briefing generator, plus the news endpoint end to end with fetch mocked
// (no network, no keys).
//
//   npm run test:agents
import assert from 'node:assert/strict';
import { buildDigest } from '../netlify/lib/news/digest';
import { FEEDS, type Feed } from '../netlify/lib/news/feeds';
import { parseFeed, toText } from '../netlify/lib/news/rss';
import { detectStatus, distinctiveWords, findingFor, watchQuery, type Article } from '../netlify/lib/watch/detect';
import { parseGdelt } from '../netlify/lib/watch/gdelt';
import { createAskEngine } from '../src/agents/ask-engine';
import { buildBriefing } from '../src/agents/briefing';
import { createCountryMatcher } from '../src/lib/text-match';
import countryNames from '../public/data/country-names.json' with { type: 'json' };
import { loadDatasetFromDisk } from './lib/dataset';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}\n  ${(err as Error).stack}`);
    process.exitCode = 1;
  }
}

const NOW = new Date('2026-10-27T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toUTCString();
const rssItem = (title: string, desc: string, url: string, date: string) =>
  `<item><title><![CDATA[${title}]]></title><description><![CDATA[${desc}]]></description><link>${url}</link><pubDate>${date}</pubDate></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.join('')}</channel></rss>`;
const feed = (id: string): Feed => FEEDS.find((f) => f.id === id)!;

// ---- RSS ---------------------------------------------------------------------------------

await test('RSS: CDATA, entities, encoded HTML and links are parsed', () => {
  const items = parseFeed(
    rss(
      rssItem("China tells Israel to stop 'forced establishment'", 'Chinese Foreign Minister Wang Yi spoke &amp; more', 'https://www.bbc.co.uk/news/a?x=1&amp;y=2', daysAgo(1)),
      `<item><title>Ports &amp; power: Beijing&#8217;s loans</title><description>&lt;p&gt;Lending &lt;b&gt;fell&lt;/b&gt; in 2025.&lt;/p&gt;</description><link>https://thediplomat.com/b</link><pubDate>${daysAgo(2)}</pubDate></item>`,
      '<item><title>No link</title></item>',
    ),
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://www.bbc.co.uk/news/a?x=1&y=2');
  assert.equal(items[0].description, 'Chinese Foreign Minister Wang Yi spoke & more');
  assert.equal(items[1].title, 'Ports & power: Beijing’s loans');
  assert.equal(items[1].description, 'Lending fell in 2025.');
  assert.ok(items[1].published.startsWith('2026-10-25'));
});

await test('RSS: Atom feeds use the alternate link', () => {
  const items = parseFeed(
    `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Xi meets Lula</title><link rel="self" href="https://x/self"/><link rel="alternate" href="https://x/story"/><summary>Talks on trade.</summary><updated>2026-10-26T10:00:00Z</updated></entry></feed>`,
  );
  assert.deepEqual(items, [{ title: 'Xi meets Lula', url: 'https://x/story', description: 'Talks on trade.', published: '2026-10-26T10:00:00.000Z' }]);
});

await test('RSS: scripts and tags never survive into text', () => {
  assert.equal(toText('<![CDATA[<script>alert(1)</script><img src=x onerror=y>Hi]]>'), 'Hi');
});

// ---- Country matching ----------------------------------------------------------------------

await test('Country matcher: longest names win, short codes are case-sensitive', () => {
  const m = createCountryMatcher(countryNames as Record<string, string>);
  assert.deepEqual(m.find('Nigeria and Niger sign deal'), ['NGA', 'NER']);
  assert.deepEqual(m.find('Equatorial Guinea port'), ['GNQ']);
  assert.deepEqual(m.find('US and UK warn China'), ['USA', 'GBR']);
  assert.deepEqual(m.find('Let us talk about trade'), []);
  assert.deepEqual(m.find('Beijing hosts Côte d’Ivoire and the DRC'), ['CIV', 'COD']);
  assert.deepEqual(m.find('China and Chinese firms'), []);
});

// ---- News digest ---------------------------------------------------------------------------

const results = [
  {
    feed: feed('bbc'),
    items: parseFeed(
      rss(
        rssItem("China tells Israel to stop 'forced establishment' of West Bank settlements", 'Chinese Foreign Minister Wang Yi spoke to Israeli President Isaac Herzog.', 'https://bbc/1', daysAgo(1)),
        rssItem('No order, no seat: Starbucks China rolls out new store policy', 'Starbucks says it is improving customers in-store experience.', 'https://bbc/2', daysAgo(2)),
        rssItem("China's big political meeting could see Xi 'tighten discipline'", 'The secretive Plenum starts Monday in Beijing.', 'https://bbc/3', daysAgo(1)),
        rssItem('Trump-Xi summit: what was not said', 'The two leaders met in Washington.', 'https://bbc/old', daysAgo(20)),
      ),
    ),
  },
  {
    feed: feed('diplomat'),
    items: parseFeed(
      rss(
        rssItem('Kenya seeks Chinese loan to extend standard gauge railway', 'Nairobi is negotiating new Belt and Road financing.', 'https://dip/1', daysAgo(3)),
        rssItem('Japan elects a new prime minister', 'Domestic politics in Tokyo.', 'https://dip/2', daysAgo(1)),
        rssItem('China and Philippines clash near Second Thomas Shoal', 'Coast guard vessels collided in the South China Sea.', 'https://dip/3', daysAgo(2)),
      ),
    ),
  },
  {
    feed: feed('cgtn'),
    items: parseFeed(rss(rssItem('China urges Israel to stop forced establishment of West Bank settlements', 'Wang Yi said in talks.', 'https://cgtn/1', daysAgo(1)))),
  },
];

await test('Digest: keeps foreign-policy stories from the past week only', () => {
  const d = buildDigest(results, NOW);
  const heads = d.items.map((i) => i.headline);
  assert.ok(heads.some((h) => h.startsWith('China tells Israel')));
  assert.ok(heads.some((h) => h.startsWith('Kenya seeks')));
  assert.ok(heads.some((h) => h.startsWith('China and Philippines')));
  assert.ok(!heads.some((h) => /Starbucks|Plenum|political meeting|Trump-Xi|Japan elects/.test(h)), heads.join(' | '));
});

await test('Digest: same story from two outlets is merged, state media labelled', () => {
  const d = buildDigest(results, NOW);
  const israel = d.items.find((i) => i.headline.startsWith('China tells Israel'))!;
  assert.deepEqual(
    israel.sources.map((s) => s.publisher),
    ['BBC News', 'CGTN (Chinese state media)'],
  );
  assert.deepEqual(israel.countries, ['ISR', 'PSE']);
  assert.equal(israel.topic, 'Diplomacy');
});

await test('Digest: Belt and Road stories are flagged and tagged', () => {
  const d = buildDigest(results, NOW);
  const kenya = d.items.find((i) => i.headline.startsWith('Kenya'))!;
  assert.equal(kenya.bri_related, true);
  assert.equal(kenya.topic, 'Belt and Road & development finance');
  assert.deepEqual(kenya.countries, ['KEN']);
  const shoal = d.items.find((i) => i.headline.startsWith('China and Philippines'))!;
  assert.equal(shoal.topic, 'Security');
  assert.equal(shoal.bri_related, false);
});

await test('Digest: overview is factual and within the database limit', () => {
  const d = buildDigest(results, NOW);
  assert.match(d.overview, /^3 stories on China's foreign relations from 3 outlets over the past week\./);
  assert.match(d.overview, /1 story mentions the Belt and Road/);
  assert.ok(d.overview.length <= 1000);
});

await test('Digest: at most 3 stories per outlet and 12 in all', () => {
  const many = Array.from({ length: 20 }, (_, i) => rssItem(`China and ${['Brazil', 'Kenya', 'Peru', 'Chile', 'Egypt'][i % 5]} sign trade deal number ${i} on soybeans ${'x'.repeat(i)}`, '', `https://g/${i}`, daysAgo(1)));
  const d = buildDigest(
    FEEDS.map((f, k) => ({ feed: f, items: parseFeed(rss(...many.map((m) => m.replace(/https:\/\/g\//, `https://${f.id}/`).replace(/number (\d+)/, `number $1 ${'abcdefghijklmnop'.slice(k, k + 3)}${k}`)))) })),
    NOW,
  );
  assert.ok(d.items.length <= 12);
  const per = new Map<string, number>();
  for (const i of d.items) per.set(i.sources[0].publisher, (per.get(i.sources[0].publisher) ?? 0) + 1);
  assert.ok([...per.values()].every((n) => n <= 3), JSON.stringify([...per]));
});

// ---- Project Watcher ------------------------------------------------------------------------

const data = loadDatasetFromDisk();
const project = (id: string) => data.projects.find((p) => p.id === id)!;
const art = (title: string, i = 0): Article => ({ url: `https://news.example/${i}`, title, domain: 'news.example', date: '2026-10-20' });

await test('Watcher: search phrases come from project names (or overrides)', () => {
  assert.equal(watchQuery(project('gwadar-port')), '"Gwadar Port"');
  assert.equal(watchQuery(project('laos-china-railway')), '"Laos China Railway"');
  assert.equal(watchQuery(project('peljesac-bridge')), '"Peljesac Bridge"');
  assert.equal(watchQuery(project('jakarta-bandung-hsr')), '("Jakarta Bandung" OR Whoosh) "high speed"');
  for (const p of data.projects) assert.ok(/"/.test(watchQuery(p)) || watchQuery(p).split(' ').length > 1, p.id);
  assert.ok(distinctiveWords(project('east-coast-rail-link')).includes('ecrl'));
});

await test('Watcher: status wording in a headline about the project is detected', () => {
  const ecrl = project('east-coast-rail-link'); // under construction
  assert.equal(detectStatus(ecrl, [art('Malaysia’s ECRL officially opens to passengers')])?.status, 'operational');
  assert.equal(detectStatus(ecrl, [art('East Coast Rail Link works halted after dispute')])?.status, 'suspended');
  assert.equal(detectStatus(ecrl, [art('Malaysia cancels East Coast Rail Link contract')])?.status, 'cancelled');
  // Status words about something else, or without the project, don't count.
  assert.equal(detectStatus(ecrl, [art('Thai railway officially opens')]), null);
  assert.equal(detectStatus(ecrl, [art('ECRL ridership forecasts revised')]), null);
  // No backwards moves: a planned project isn't "suspended" by an opening story, an operational one doesn't "open".
  assert.equal(detectStatus(project('laos-china-railway'), [art('Laos China railway opens to new freight route')]), null);
  assert.equal(detectStatus(project('kyaukphyu-deep-sea-port'), [art('Groundbreaking held at Kyaukphyu deep sea port')])?.status, 'under-construction');
});

await test('Watcher: findings need a status signal or notable coverage, and cite sources', () => {
  const ecrl = project('east-coast-rail-link');
  assert.equal(findingFor(ecrl, [], '2026-10-27'), null);
  assert.equal(findingFor(ecrl, [art('ECRL progress update')], '2026-10-27'), null);
  const f = findingFor(ecrl, [art('ECRL progress update', 1), art('ECRL officially opens to passengers', 2)], '2026-10-27')!;
  assert.equal(f.suggested_status, 'operational');
  assert.equal(f.sources[0].url, 'https://news.example/2');
  assert.match(f.status_note, /Headline suggests "Operational"/);
  const coverage = findingFor(ecrl, [1, 2, 3, 4, 5, 6].map((i) => art(`ECRL story ${i}`, i)), '2026-10-27')!;
  assert.equal(coverage.suggested_status, 'under-construction');
  assert.equal(coverage.sources.length, 4);
  assert.ok(coverage.summary.length <= 1000 && coverage.status_note.length <= 500);
});

await test('Watcher: GDELT responses are parsed and de-duplicated', () => {
  const a = parseGdelt(
    JSON.stringify({
      articles: [
        { url: 'https://a/1', title: 'ECRL  update', seendate: '20261020T101500Z', domain: 'a', language: 'English' },
        { url: 'https://a/1', title: 'dup', seendate: '20261020T101500Z', domain: 'a' },
        { url: 'javascript:alert(1)', title: 'bad', seendate: '20261020T101500Z' },
      ],
    }),
  );
  assert.deepEqual(a, [{ url: 'https://a/1', title: 'ECRL update', domain: 'a', date: '2026-10-20' }]);
  assert.deepEqual(parseGdelt('{}'), []);
  assert.throws(() => parseGdelt('Please limit requests to one every 5 seconds'), /GDELT: Please limit/);
});

// ---- Ask the Map ----------------------------------------------------------------------------

const engine = createAskEngine(data);
const ask = (q: string, ctx?: Parameters<typeof engine.answer>[1]) => engine.answer(q, ctx);

await test('Ask: countries, projects and corridors move the map', () => {
  assert.deepEqual(ask('Tell me about Kenya').actions[0], { action: 'focus_country', iso3: 'KEN' });
  assert.deepEqual(ask('Laos').actions[0], { action: 'focus_country', iso3: 'LAO' });
  assert.deepEqual(ask('Laos railway').actions[0], { action: 'focus_project', id: 'laos-china-railway' });
  assert.deepEqual(ask('Hambantota port').actions[0], { action: 'focus_project', id: 'hambantota-port' });
  assert.deepEqual(ask('Whoosh').actions[0], { action: 'focus_project', id: 'jakarta-bandung-hsr' });
  assert.deepEqual(ask('What is CPEC?').actions, [{ action: 'add_layers', layers: ['corridors'] }]);
});

await test('Ask: rankings come from AidData and cite it', () => {
  const r = ask('Which countries received the most Chinese loans for railways?');
  assert.match(r.reply, /^Countries receiving the most Chinese official finance in the AidData records \(railways & metros\)/);
  assert.match(r.reply, /1\. \*\*Kenya\*\*/);
  assert.match(r.reply, /\[Global Chinese Development Finance Dataset\]\(https:/);
  const banks = ask('Which banks lent the most in Africa since 2015?');
  assert.match(banks.reply, /Largest Chinese lenders .*in Sub-Saharan Africa, since 2015/);
  assert.match(banks.reply, /1\. \*\*Export-Import Bank of China/);
});

await test('Ask: membership, years, comparisons and follow-ups', () => {
  const m = ask('How many countries had joined by 2017?');
  assert.match(m.reply, /By the end of 2017, \*\*\d+\*\* countries/);
  assert.deepEqual(m.actions[0], { action: 'set_year', year: 2017 });
  assert.deepEqual(ask('2019').actions, [{ action: 'set_year', year: 2019 }]);
  assert.match(ask('compare Pakistan vs Bangladesh').reply, /Comparing Pakistan and Bangladesh/);
  const first = ask('Tell me about Kenya');
  const follow = ask('what about its railways?', first.context);
  assert.match(follow.reply, /Railways & metros on the map/);
  assert.match(follow.reply, /Mombasa–Nairobi/);
});

await test('Ask: unknown questions get help, never invented facts', () => {
  assert.match(ask('asdf qwerty').reply, /couldn't match that/);
  assert.match(ask('help').reply, /simple rules rather than AI/);
  assert.match(ask('Portugal').reply, /no flagship projects in Portugal/);
});

// ---- My Briefing ----------------------------------------------------------------------------

await test('Briefing: covers saved items, region and matching news', () => {
  const md = buildBriefing({
    data,
    profile: { display_name: 'Ana', region_of_interest: 'Sub-Saharan Africa', saved_items: [{ kind: 'country', id: 'KEN' }, { kind: 'project', id: 'lekki-deep-sea-port' }] },
    news: [
      { headline: 'Kenya seeks Chinese loan', date: '2026-10-24', topic: 'Belt and Road & development finance', countries: ['KEN'], bri_related: true, sources: [{ url: 'https://dip/1', publisher: 'The Diplomat' }] },
      { headline: 'Unrelated', date: '2026-10-24', topic: 'Security', countries: ['PHL'], bri_related: false, sources: [{ url: 'https://dip/3', publisher: 'The Diplomat' }] },
    ],
    updates: {},
    now: NOW,
  });
  assert.match(md, /## Briefing for Ana, 27 October 2026/);
  assert.match(md, /\*\*Kenya\*\*: MoU 2017/);
  assert.match(md, /\*\*Lekki Deep Sea Port\*\*: operational/);
  assert.match(md, /### Sub-Saharan Africa/);
  assert.match(md, /### In the news for your countries and region\n\n- Kenya seeks Chinese loan \(\[The Diplomat\]\(https:\/\/dip\/1\)/);
  assert.ok(!md.includes('Unrelated'));
});

await test('Briefing: works for a new user with an empty profile', () => {
  const md = buildBriefing({ data, profile: null, news: [], updates: {}, now: NOW });
  assert.match(md, /no saved items yet/);
  assert.match(md, /### Worldwide/);
});

// ---- News endpoint, end to end with fetch mocked ------------------------------------------

await test('News endpoint: 503 when the service key is missing', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { default: handler } = await import('../netlify/functions/agent-news-run.mts');
  const res = await handler(new Request('http://x/api/agents/news/run', { method: 'POST' }));
  assert.equal(res.status, 503);
});

await test('News endpoint: an admin run reads the feeds and publishes a digest', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const realFetch = globalThis.fetch;
  const inserted: Record<string, unknown>[] = [];
  const runUpdates: Record<string, unknown>[] = [];
  const feedXml = new Map<string, string>([
    [feed('bbc').url, rss(rssItem("China tells Israel to stop 'forced establishment'", 'Foreign Minister Wang Yi spoke.', 'https://bbc/1', new Date(Date.now() - 864e5).toUTCString()))],
    [feed('diplomat').url, rss(rssItem('Kenya seeks Chinese loan for railway', 'New Belt and Road financing.', 'https://dip/1', new Date(Date.now() - 2 * 864e5).toUTCString()))],
  ]);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers);
    const one = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
    const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(body === null ? null : JSON.stringify(one && Array.isArray(body) ? body[0] : body), { status, headers: { 'content-type': 'application/json', ...extra } });
    if (feedXml.has(url)) return new Response(feedXml.get(url), { status: 200 });
    if (FEEDS.some((f) => f.url === url)) return new Response('nope', { status: 503 });
    if (url.includes('/auth/v1/user')) {
      assert.equal(headers.get('authorization'), 'Bearer user-token');
      return reply({ id: 'u1', email: 'admin@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' });
    }
    if (url.includes('/rest/v1/app_admins')) return reply([{ user_id: 'u1' }]);
    if (url.includes('/rest/v1/agent_usage')) return method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-range': '*/0' } }) : reply(null, 201);
    if (url.includes('/rest/v1/agent_runs') && method === 'POST') return reply([{ id: 'run-1' }], 201);
    if (url.includes('/rest/v1/agent_runs') && method === 'PATCH') {
      runUpdates.push(JSON.parse(String(init?.body)));
      return reply(null, 204);
    }
    if (url.includes('/rest/v1/news_digests') && method === 'POST') {
      inserted.push(JSON.parse(String(init?.body)));
      return reply([{ id: 'digest-1' }], 201);
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  try {
    const { default: handler } = await import('../netlify/functions/agent-news-run.mts');
    const denied = await handler(new Request('http://x/api/agents/news/run', { method: 'POST' }));
    assert.equal(denied.status, 403);
    const res = await handler(new Request('http://x/api/agents/news/run', { method: 'POST', headers: { authorization: 'Bearer user-token' } }));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.stories, 2);
    assert.equal(body.outlets, 2);
    assert.equal(body.failed.length, FEEDS.length - 2);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].status, 'ready');
    assert.equal(inserted[0].model, 'rss-rules');
    assert.equal((inserted[0].items as unknown[]).length, 2);
    assert.equal(runUpdates.at(-1)?.status, 'succeeded');
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log(`\n${passed} agent tests passed${process.exitCode ? ' (with failures above)' : ''}`);
