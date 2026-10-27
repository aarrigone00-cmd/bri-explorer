// Offline tests for the agent functions: real data tools, real agent loops,
// with a scripted fake in place of the Claude API (no network, no API key).
//
//   npx tsx scripts/test-agents.ts
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import type { MessagesClient } from '../netlify/lib/anthropic';
import { runAsk, sanitizeHistory } from '../netlify/lib/agents/ask';
import { runBriefing } from '../netlify/lib/agents/briefing';
import { runNewsDigest } from '../netlify/lib/agents/news';
import { checkProject, pickProjects } from '../netlify/lib/agents/watch';
import { projectById } from '../netlify/lib/data';
import { runToolLoop } from '../netlify/lib/loop';
import { runDataTool, toMapAction } from '../netlify/lib/site-tools';
import type { Profile } from '../src/types';

type Msg = Anthropic.Beta.BetaMessage;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

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

const usage = { input_tokens: 10, output_tokens: 10 } as Msg['usage'];
function msg(stop: Msg['stop_reason'], content: unknown[]): Msg {
  return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage } as unknown as Msg;
}
const text = (t: string) => ({ type: 'text', text: t, citations: null });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const searchResults = (id: string, urls: string[]) => [
  { type: 'server_tool_use', id, name: 'web_search', input: { query: 'q' } },
  { type: 'web_search_tool_result', tool_use_id: id, content: urls.map((url, i) => ({ type: 'web_search_result', url, title: `Result ${i}`, page_age: null, encrypted_content: 'x' })) },
];

/** Fake client that replays scripted responses and records each request. */
function fake(script: (Msg | ((p: Params) => Msg))[]): MessagesClient & { calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    async create(params) {
      calls.push(structuredClone(params));
      const next = script.shift();
      if (!next) throw new Error('Fake client ran out of scripted responses');
      return typeof next === 'function' ? next(params) : next;
    },
  };
}
const lastToolResults = (p: Params) => {
  const last = p.messages[p.messages.length - 1];
  return (Array.isArray(last.content) ? last.content : []) as Anthropic.Beta.BetaToolResultBlockParam[];
};

// ---- Data tools ----------------------------------------------------------------------

await test('search_site finds countries, flagship projects and AidData records', () => {
  const r = runDataTool('search_site', { query: 'kenya' }) as { countries: { iso3: string }[]; flagship_projects: { id: string }[]; aiddata_records: unknown[] };
  assert.equal(r.countries[0].iso3, 'KEN');
  assert.ok(r.flagship_projects.some((p) => p.id === 'mombasa-nairobi-sgr'));
  assert.ok(r.aiddata_records.length > 0);
});

await test('get_country returns BRI status, projects, corridors and AidData totals', () => {
  const r = runDataTool('get_country', { iso3: 'pak' }) as Record<string, any>;
  assert.equal(r.name, 'Pakistan');
  assert.match(r.bri_status, /BRI participant/);
  assert.ok(r.economic_corridors.some((c: string) => c.includes('CPEC')));
  assert.ok(r.flagship_projects.length >= 5);
  assert.ok(r.aiddata_2013_2021.records > 0 && r.aiddata_2013_2021.total_committed_usd_bn_2021 > 0);
  assert.equal((runDataTool('get_country', { iso3: 'XYZ' }) as { error?: string }).error?.includes('No data'), true);
});

await test('query_aiddata filters and groups (rail loans in Sub-Saharan Africa by country)', () => {
  const r = runDataTool('query_aiddata', { region: 'Sub-Saharan Africa', type: 'rail', group_by: 'country', limit: 5 }) as Record<string, any>;
  assert.ok(r.matched_records > 0);
  assert.ok(r.groups.length > 0 && r.groups.length <= 5);
  for (let i = 1; i < r.groups.length; i++) assert.ok(r.groups[i - 1].committed_usd_bn_2021 >= r.groups[i].committed_usd_bn_2021);
  assert.ok(r.largest_records.every((x: { type: string }) => x.type === 'rail'));
});

await test('get_overview reports totals from the data files', () => {
  const r = runDataTool('get_overview', {}) as Record<string, any>;
  assert.equal(r.bri_participants.count_with_dated_mou_incl_china, 146);
  assert.equal(r.aiddata.records, 1297);
  assert.equal(r.economic_corridors.length, 6);
  assert.equal(r.latest_engagement.periods[0].total, 213.5);
});

await test('update_map actions are validated', () => {
  assert.deepEqual(toMapAction({ action: 'focus_country', iso3: 'ken' }), { action: 'focus_country', iso3: 'KEN' });
  assert.ok('error' in toMapAction({ action: 'focus_project', project_id: 'nope' }));
  assert.ok('error' in toMapAction({ action: 'set_year', year: 1999 }));
  assert.deepEqual(toMapAction({ action: 'show_layers', layers: ['rail', 'bogus', 'aiddata'] }), { action: 'show_layers', layers: ['rail', 'aiddata'] });
});

// ---- Loop ------------------------------------------------------------------------------

await test('loop resumes pause_turn and sends every request with model, fallback and caching', async () => {
  const client = fake([msg('pause_turn', [text('…')]), msg('end_turn', [text('done')])]);
  const r = await runToolLoop(client, { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], effort: 'low', runTool: () => ({}) });
  assert.equal(r.rounds, 2);
  assert.equal(client.calls.length, 2);
  for (const c of client.calls) {
    assert.equal(c.model, 'claude-opus-5-5');
    assert.deepEqual(c.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(c.fallbacks, 'default');
    assert.deepEqual(c.cache_control, { type: 'ephemeral' });
    assert.equal(c.output_config?.effort, 'low');
  }
});

await test('loop wraps up with tools disabled when the round budget runs out', async () => {
  const client = fake([msg('tool_use', [toolUse('t1', 'get_overview', {})]), msg('end_turn', [text('summary')])]);
  const r = await runToolLoop(client, { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], effort: 'low', maxRounds: 1, runTool: () => ({ ok: 1 }) });
  assert.equal(r.truncated, true);
  assert.deepEqual(client.calls[1].tool_choice, { type: 'none' });
});

await test('loop surfaces refusals as a clear error', async () => {
  const client = fake([msg('refusal', [])]);
  await assert.rejects(runToolLoop(client, { system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], effort: 'low', runTool: () => ({}) }), /declined/);
});

// ---- Agent 1: Ask the Map ----------------------------------------------------------------

await test('Ask the Map: runs data tools, collects map actions and returns the answer', async () => {
  const client = fake([
    msg('tool_use', [
      toolUse('t1', 'query_aiddata', { type: 'rail', group_by: 'country', limit: 3 }),
      toolUse('t2', 'update_map', { action: 'show_layers', layers: ['rail', 'aiddata'] }),
      toolUse('t3', 'update_map', { action: 'focus_country', iso3: 'XXX' }),
    ]),
    (p) => {
      const results = lastToolResults(p);
      assert.equal(results.length, 3, 'all tool results in one message');
      assert.ok(String(results[0].content).includes('committed_usd_bn_2021'));
      assert.equal(results[2].is_error, true, 'invalid map action reported to the model');
      return msg('end_turn', [text('**Laos** received the most (AidData GCDF v3).')]);
    },
  ]);
  const r = await runAsk(client, [{ role: 'user', content: 'Who got the most rail loans?' }]);
  assert.match(r.reply, /Laos/);
  assert.deepEqual(r.actions, [{ action: 'show_layers', layers: ['rail', 'aiddata'] }]);
  const tools = (client.calls[0].tools ?? []).map((t) => ('name' in t ? t.name : ''));
  assert.deepEqual(tools, ['search_site', 'get_country', 'get_project', 'query_aiddata', 'get_overview', 'update_map']);
});

await test('Ask the Map: history is trimmed and must end with a user question', () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  long.push({ role: 'user', content: 'last' });
  const h = sanitizeHistory(long);
  assert.ok(h.length <= 12 && h[0].role === 'user' && h[h.length - 1].content === 'last');
  assert.throws(() => sanitizeHistory([{ role: 'assistant', content: 'hi' }]), /type a question/);
  assert.throws(() => sanitizeHistory('nope'), /array/);
});

// ---- Agent 4: China & the World ------------------------------------------------------------

const goodUrls = ['https://www.reuters.com/world/china/a', 'https://apnews.com/article/b', 'https://www.fmprc.gov.cn/eng/c'];
const item = (urls: string[], extra: Record<string, unknown> = {}) => ({
  headline: 'H',
  date: '2026-10-20',
  summary: 'S',
  why_it_matters: 'W',
  perspectives: '',
  topic: 'Diplomacy',
  countries: ['KEN', 'zzz'],
  bri_related: true,
  sources: urls.map((url) => ({ url, title: 't', publisher: 'p' })),
  ...extra,
});

await test('News digest: keeps only sources seen in web search and drops invented links', async () => {
  const client = fake([
    msg('tool_use', [
      ...searchResults('s1', goodUrls),
      toolUse('p1', 'publish_digest', {
        overview: 'O',
        items: [item([goodUrls[0], 'https://invented.example/x']), item([`${goodUrls[1]}?utm_source=x`]), item([goodUrls[2]]), item(['https://made-up.example/y'])],
      }),
    ]),
    msg('end_turn', [text('Published.')]),
  ]);
  const d = await runNewsDigest(client, '2026-10-27');
  assert.equal(d.items.length, 3, 'item with only invented sources is dropped');
  assert.deepEqual(d.items[0].sources.map((s) => s.url), [goodUrls[0]]);
  assert.equal(d.items[1].sources.length, 1, 'tracking parameters are ignored when matching');
  assert.equal(d.searches, 1);
  const tools = client.calls[0].tools ?? [];
  assert.ok(tools.some((t) => 'type' in t && t.type === 'web_search_20260209'));
});

await test('News digest: asks the model to retry when too few items are sourced', async () => {
  const client = fake([
    msg('tool_use', [...searchResults('s1', goodUrls), toolUse('p1', 'publish_digest', { overview: 'O', items: [item(['https://fake.example/1'])] })]),
    (p) => {
      assert.equal(lastToolResults(p)[0].is_error, true);
      return msg('tool_use', [toolUse('p2', 'publish_digest', { overview: 'O', items: goodUrls.map((u) => item([u])) })]);
    },
    msg('end_turn', [text('ok')]),
  ]);
  const d = await runNewsDigest(client, '2026-10-27');
  assert.equal(d.items.length, 3);
});

await test('News digest: fails clearly if nothing is published', async () => {
  const client = fake([msg('end_turn', [text('I could not find news.')])]);
  await assert.rejects(runNewsDigest(client, '2026-10-27'), /did not produce a digest/);
});

// ---- Agent 2: Project Watcher --------------------------------------------------------------

await test('Project Watcher: records a sourced change for a project', async () => {
  const p = projectById.get('east-coast-rail-link')!;
  const client = fake([
    msg('tool_use', [
      ...searchResults('s1', ['https://www.thestar.com.my/news/ecrl']),
      toolUse('r1', 'report_finding', {
        changed: true,
        suggested_status: 'partially-operational',
        status_note: 'Northern section opened.',
        summary: 'Reports say…',
        as_of: '2026-10-01',
        sources: [{ url: 'https://www.thestar.com.my/news/ecrl', title: 'ECRL', publisher: 'The Star' }],
      }),
    ]),
    msg('end_turn', [text('Done.')]),
  ]);
  const f = await checkProject(client, p, '2026-10-27');
  assert.ok(f && f.changed && f.suggested_status === 'partially-operational' && f.sources.length === 1);
});

await test('Project Watcher: a change without real sources is rejected', async () => {
  const p = projectById.get('east-coast-rail-link')!;
  const client = fake([
    msg('tool_use', [toolUse('r1', 'report_finding', { changed: true, suggested_status: 'operational', status_note: 'x', summary: 'x', as_of: 'x', sources: [{ url: 'https://nowhere.example', title: 't', publisher: 'p' }] })]),
    (params) => {
      assert.equal(lastToolResults(params)[0].is_error, true);
      return msg('tool_use', [toolUse('r2', 'report_finding', { changed: false, suggested_status: p.status, status_note: '', summary: 'No news.', as_of: '2026-10-27', sources: [] })]);
    },
    msg('end_turn', [text('Done.')]),
  ]);
  const f = await checkProject(client, p, '2026-10-27');
  assert.ok(f && !f.changed);
});

await test('Project Watcher: checks unfinished projects plus the least recently checked others', () => {
  const list = pickProjects(new Map([['laos-china-railway', '2026-10-20']]), 4);
  assert.ok(list.some((p) => p.id === 'east-coast-rail-link'));
  assert.ok(list.filter((p) => ['operational', 'completed', 'cancelled'].includes(p.status)).length === 4);
  assert.ok(!list.some((p) => p.id === 'laos-china-railway'), 'recently checked project waits its turn');
});

// ---- Agent 3: My Briefing ------------------------------------------------------------------

await test('My Briefing: includes profile, saved items and news in the request', async () => {
  const profile: Profile = {
    id: 'u',
    display_name: 'Angela',
    affiliation: 'FAU',
    region_of_interest: 'Sub-Saharan Africa',
    bio: 'global politics',
    saved_items: [
      { kind: 'country', id: 'KEN' },
      { kind: 'project', id: 'mombasa-nairobi-sgr' },
    ],
    created_at: '',
    updated_at: '',
  };
  const client = fake([
    (p) => {
      const user = String(p.messages[0].content);
      assert.match(user, /Sub-Saharan Africa/);
      assert.match(user, /Country: Kenya/);
      assert.match(user, /Mombasa–Nairobi/);
      assert.match(user, /Kenya rail deal/);
      return msg('tool_use', [toolUse('t1', 'get_country', { iso3: 'KEN' })]);
    },
    msg('end_turn', [text('## At a glance\nKenya…')]),
  ]);
  const r = await runBriefing(client, profile, [
    { headline: 'Kenya rail deal', date: '2026-10-20', summary: 's', why_it_matters: '', perspectives: '', topic: 'Diplomacy', countries: ['KEN'], bri_related: true, sources: [{ url: 'u', title: 't', publisher: 'Reuters' }] },
  ]);
  assert.match(r.markdown, /At a glance/);
});

// ---- HTTP handlers -------------------------------------------------------------------------

await test('Ask endpoint: 503 with a clear message when keys are missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { default: handler } = await import('../netlify/functions/agent-ask.mts');
  const res = await handler(new Request('http://x/api/agents/ask', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not set up yet/);
});

await test('Ask endpoint: 400 for an empty question (before any network call)', async () => {
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  const { default: handler } = await import('../netlify/functions/agent-ask.mts');
  const res = await handler(new Request('http://x/api/agents/ask', { method: 'POST', body: JSON.stringify({ messages: [] }) }));
  assert.equal(res.status, 400);
});

await test('Status endpoint reports configuration without exposing secrets', async () => {
  const { default: handler } = await import('../netlify/functions/agent-status.mts');
  const body = await (await handler()).json();
  assert.deepEqual(Object.keys(body).sort(), ['anthropic', 'model', 'ready', 'supabase']);
  assert.ok(!JSON.stringify(body).includes('test'));
});

console.log(`\n${passed} agent tests passed${process.exitCode ? ' (with failures above)' : ''}`);
