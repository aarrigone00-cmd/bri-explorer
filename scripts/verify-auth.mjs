// Login smoke test. Requires a build made with VITE_SUPABASE_URL and
// VITE_SUPABASE_PUBLISHABLE_KEY set (npm run build). Supabase's Auth API is
// mocked in the browser, so this never touches the real project or sends email.
//
//   npm run build && node scripts/verify-auth.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4180;
const URL = `http://localhost:${PORT}/`;
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const outDir = process.env.SCREENSHOT_DIR || 'screenshots';
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'pipe',
});
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', (c) => reject(new Error(`preview exited ${c}`)));
  setTimeout(() => reject(new Error('preview timeout')), 20000);
});

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const EMAIL = 'tester@example.com';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', email: EMAIL, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600, session_id: 's1' })}.c2ln`;
const user = {
  id: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  email: EMAIL,
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [{ id: 'user-1', provider: 'email', identity_data: { email: EMAIL } }],
  created_at: new Date().toISOString(),
};
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh-1', user };

/** Mocks the Supabase Auth endpoints and records the calls made. */
async function mockAuth(page) {
  const calls = [];
  await page.route('**/auth/v1/**', async (route) => {
    const req = route.request();
    const u = new globalThis.URL(req.url());
    const path = u.pathname.replace(/.*\/auth\/v1/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path, query: u.search, body, apikey: req.headers()['apikey'] });
    const json = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/token' && u.searchParams.get('grant_type') === 'password') {
      if (body.password === 'not-confirmed') return json(400, { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return body.password === 'correct-horse'
        ? json(200, session)
        : json(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (path === '/signup') return json(200, { ...user, email: body.email, email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() });
    if (path === '/recover') return json(200, {});
    if (path === '/resend') return json(200, {});
    if (path === '/logout') return route.fulfill({ status: 204 });
    if (path === '/user') return json(200, user);
    return json(404, { msg: 'not mocked' });
  });

  // PostgREST mock for public.profiles, enforcing "own row only" like RLS.
  const profiles = new Map();
  await page.route('**/rest/v1/profiles**', async (route) => {
    const req = route.request();
    const u = new globalThis.URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const authed = (req.headers()['authorization'] ?? '').includes(jwt);
    calls.push({ method: req.method(), path: '/rest/profiles', query: u.search, body, authed });
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const send = (rows) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? rows[0] ?? null : rows) });
    if (!authed) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'JWT required' }) });
    const id = (u.searchParams.get('id') ?? '').replace(/^eq\./, '') || body?.id;
    if (id !== 'user-1') return send([]); // RLS: other users' rows are invisible
    const now = new Date().toISOString();
    if (req.method() === 'GET') return send(profiles.has(id) ? [profiles.get(id)] : []);
    if (req.method() === 'POST') {
      const row = { display_name: null, affiliation: null, region_of_interest: null, bio: null, saved_items: [], created_at: now, ...body, updated_at: now };
      profiles.set(id, row);
      return send([row]);
    }
    if (req.method() === 'PATCH') {
      const row = { ...profiles.get(id), ...body, updated_at: now };
      profiles.set(id, row);
      return send([row]);
    }
    return route.fulfill({ status: 405 });
  });

  // ---- Agents: Netlify function endpoints (Claude is never called in tests) ----
  const fulfillJson = (route, status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const bearer = (req) => (req.headers()['authorization'] ?? '').includes(jwt);
  await page.route('**/api/agents/status', (route) => fulfillJson(route, 200, { ready: true, anthropic: true, supabase: true }));
  await page.route('**/api/agents/ask', (route) => {
    const req = route.request();
    calls.push({ method: 'POST', path: '/api/ask', body: JSON.parse(req.postData() || '{}'), authed: bearer(req) });
    if (!bearer(req)) return fulfillJson(route, 401, { error: 'Please sign in to use the agents.' });
    return fulfillJson(route, 200, {
      reply: 'Kenya received **US$4.8 bn** in rail commitments (AidData GCDF v3).\n\n- Mombasa–Nairobi SGR\n- [Source](https://www.aiddata.org/)',
      actions: [{ action: 'focus_country', iso3: 'KEN' }, { action: 'set_year', year: 2017 }],
      truncated: false,
    });
  });
  await page.route('**/api/agents/briefing', (route) => {
    calls.push({ method: 'POST', path: '/api/briefing', authed: bearer(route.request()) });
    return fulfillJson(route, 200, { id: 'b1', content: '## At a glance\nYour region is **Sub-Saharan Africa**.\n## Your saved items\n- Kenya', created_at: new Date().toISOString() });
  });
  for (const agent of ['news', 'watch']) {
    await page.route(`**/api/agents/${agent}/run`, (route) => {
      calls.push({ method: 'POST', path: `/api/${agent}/run`, authed: bearer(route.request()) });
      return route.fulfill({ status: 202, body: '' });
    });
  }

  // ---- Agents: Supabase tables (RLS behaviour mirrored) ----
  const rows = (route, data) => {
    const wantsObject = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object');
    return fulfillJson(route, 200, wantsObject ? data[0] ?? null : data);
  };
  await page.route('**/rest/v1/app_admins**', (route) => rows(route, bearer(route.request()) ? [{ user_id: 'user-1' }] : []));
  await page.route('**/rest/v1/news_digests**', (route) =>
    rows(route, [{
      id: 'd1',
      overview: 'A week of summit diplomacy and new infrastructure deals.',
      completed_at: new Date().toISOString(),
      search_count: 7,
      model: 'claude-opus-5-5',
      items: [
        { headline: 'China and Kenya sign rail financing deal', date: '2026-10-22', summary: 'Officials signed an agreement.', why_it_matters: 'Extends the SGR.', perspectives: 'Nairobi welcomed it; critics cite debt.', topic: 'Belt and Road & development finance', countries: ['KEN'], bri_related: true, sources: [{ url: 'https://www.reuters.com/x', title: 'Rail deal', publisher: 'Reuters' }] },
        { headline: 'Foreign ministers meet at regional forum', date: '2026-10-21', summary: 'Talks on trade.', why_it_matters: '', perspectives: '', topic: 'Diplomacy', countries: [], bri_related: false, sources: [{ url: 'https://apnews.com/y', title: 'Forum', publisher: 'AP' }] },
        { headline: 'Port agreement in Peru expanded', date: '2026-10-20', summary: 'Chancay expansion.', why_it_matters: '', perspectives: '', topic: 'Trade & economy', countries: ['PER'], bri_related: true, sources: [{ url: 'https://example.org/z', title: 'Port', publisher: 'Example' }] },
      ],
    }]),
  );
  const approved = { id: 's0', project_id: 'east-coast-rail-link', current_status: 'under-construction', suggested_status: 'partially-operational', status_note: 'The northern section opened to passengers.', summary: '', as_of: '2026-10-01', sources: [{ url: 'https://www.thestar.com.my/ecrl', title: 'ECRL', publisher: 'The Star' }], review_status: 'approved', reviewed_at: '2026-10-02T00:00:00Z', created_at: '2026-10-01T00:00:00Z' };
  const pending = { ...approved, id: 's1', project_id: 'kyaukphyu-deep-sea-port', current_status: 'planned', suggested_status: 'suspended', status_note: 'Work reported halted.', summary: 'Two outlets report a halt.', review_status: 'pending', reviewed_at: null };
  await page.route('**/rest/v1/project_update_suggestions**', (route) => {
    const req = route.request();
    const q = decodeURIComponent(new globalThis.URL(req.url()).search);
    if (req.method() === 'PATCH') {
      calls.push({ method: 'PATCH', path: '/rest/suggestions', query: q, body: JSON.parse(req.postData() || '{}'), authed: bearer(req) });
      return rows(route, []);
    }
    if (q.includes('review_status=eq.pending')) return rows(route, bearer(req) ? [pending] : []);
    return rows(route, [approved]);
  });
  await page.route('**/rest/v1/agent_runs**', (route) => rows(route, bearer(route.request()) ? [{ status: 'succeeded', started_at: '2026-10-26T07:00:00Z', finished_at: '2026-10-26T07:05:00Z', detail: { checked: 11, suggestions: 1 } }] : []));
  await page.route('**/rest/v1/user_briefings**', (route) => rows(route, []));
  return calls;
}

const browser = await chromium.launch({ executablePath });
try {
  for (const vp of [
    { name: 'desktop', width: 1280, height: 860 },
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const calls = await mockAuth(page);
    const tag = `auth-${vp.name}`;

    await page.goto(URL);
    await page.waitForSelector('[data-sign-in]');
    check(true, `[${tag}] "Sign in" button shown in header`);

    // ---- Agents while signed out ----
    await page.waitForSelector('#news-body .news-item');
    check((await page.textContent('#news-body')).includes('China and Kenya sign rail financing deal'), `[${tag}] news digest is public`);
    check(!(await page.locator('[data-news-run]').count()), `[${tag}] visitors don't see the admin run button`);
    await page.click('#ask-toggle');
    await page.waitForSelector('#ask-notice [data-ask-login]');
    check(await page.locator('#ask-input').isDisabled(), `[${tag}] Ask the Map asks visitors to sign in`);
    await page.click('#ask-close');

    // Wrong password → friendly error
    await page.click('[data-sign-in]');
    await page.waitForSelector('#auth-dialog[open]');
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', 'nope');
    await page.click('#auth-submit');
    await page.waitForSelector('.auth__message--error');
    check((await page.textContent('#auth-message')) === 'Incorrect email or password.', `[${tag}] wrong password shows a clear error`);
    const tokenCall = calls.find((c) => c.path === '/token');
    check(tokenCall?.apikey?.startsWith('sb_publishable_'), `[${tag}] requests use the publishable key`);
    await page.screenshot({ path: `${outDir}/${tag}-error.png` });

    // Unconfirmed email → offer to resend the confirmation link
    await page.fill('#auth-password', 'not-confirmed');
    await page.click('#auth-submit');
    await page.waitForSelector('[data-resend]');
    await page.click('[data-resend]');
    await page.waitForSelector('.auth__message--success');
    const resend = calls.find((c) => c.path === '/resend');
    check(resend?.body?.email === EMAIL && resend?.body?.type === 'signup', `[${tag}] unconfirmed email can resend the confirmation link`);

    // Correct password → signed in, email in header
    await page.fill('#auth-password', 'correct-horse');
    await page.click('#auth-submit');
    await page.waitForSelector('[data-sign-out]');
    check(!(await page.locator('#auth-dialog[open]').count()), `[${tag}] dialog closes after sign-in`);
    await page.waitForSelector('[data-open-profile]');
    check(true, `[${tag}] header shows profile button`);
    await page.waitForFunction(() => window.bri?.store.get().profile !== null);
    check(calls.some((c) => c.path === '/rest/profiles' && c.method === 'POST'), `[${tag}] missing profile row is created on first sign-in`);

    // ---- Profile: edit and save ----
    await page.click('[data-open-profile]');
    await page.waitForSelector('#profile-dialog[open]');
    check((await page.textContent('#profile-email')) === EMAIL, `[${tag}] profile shows account email`);
    check((await page.inputValue('#profile-form [name="display_name"]')) === 'tester', `[${tag}] display name defaults from email`);
    await page.fill('#profile-form [name="display_name"]', 'Ada Researcher');
    await page.fill('#profile-form [name="affiliation"]', 'Example University');
    await page.selectOption('#profile-form [name="region_of_interest"]', 'Sub-Saharan Africa');
    await page.fill('#profile-form [name="bio"]', 'Studying rail finance.');
    await page.click('#profile-submit');
    await page.waitForSelector('#profile-message.auth__message--success');
    const patch = calls.filter((c) => c.path === '/rest/profiles' && c.method === 'PATCH').at(-1);
    check(
      patch?.body?.display_name === 'Ada Researcher' && patch.body.affiliation === 'Example University' && patch.body.region_of_interest === 'Sub-Saharan Africa' && patch.body.bio === 'Studying rail finance.',
      `[${tag}] profile fields saved to Supabase`,
    );
    check(patch?.query.includes('id=eq.user-1'), `[${tag}] update is scoped to the signed-in user`);
    await page.waitForFunction(() => document.querySelector('.avatar')?.textContent === 'AR');
    check(true, `[${tag}] header updates with new name initials`);
    check((await page.textContent('#profile-saved')).includes('Nothing saved yet'), `[${tag}] empty saved list explained`);
    await page.screenshot({ path: `${outDir}/${tag}-profile.png` });
    await page.click('#profile-close');

    // ---- Agent 1: Ask the Map ----
    await page.click('#ask-toggle');
    await page.waitForSelector('#ask-input:not([disabled])');
    check((await page.locator('.ask__chip').count()) >= 3, `[${tag}] ask panel shows suggested questions`);
    await page.fill('#ask-input', 'Which country got the most rail loans?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ask__msg--assistant strong', { state: 'attached' });
    const askCall = calls.find((c) => c.path === '/api/ask');
    check(askCall?.authed && askCall.body.messages.at(-1).content.includes('rail loans'), `[${tag}] question sent with the user's token`);
    check(await page.evaluate(() => window.bri.store.get().year) === 2017, `[${tag}] agent's map actions applied (timeline)`);
    await page.waitForFunction(() => document.querySelector('.detail__title')?.textContent === 'Kenya');
    check(true, `[${tag}] agent's map actions applied (zoomed to Kenya)`);
    const answerHtml = await page.innerHTML('.ask__msg--assistant');
    check(answerHtml.includes('<li>') && answerHtml.includes('target="_blank"') && !answerHtml.includes('**'), `[${tag}] answer rendered as safe Markdown`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${tag}-ask.png` });
    if (vp.name === 'phone') check(await page.locator('#ask-panel').isHidden(), `[${tag}] on phones the chat steps aside for the opened country`);
    await page.click('[data-close-detail]');
    if (await page.locator('#ask-panel').isVisible()) await page.click('#ask-close');
    await page.evaluate(() => window.bri.store.set({ year: 2026 }));

    // ---- Agent 3 (briefing) and Agent 2 (review queue) in the profile ----
    await page.click('[data-open-profile]');
    await page.waitForSelector('#review-section:not([hidden]) .review');
    check((await page.textContent('#review-list')).includes('Kyaukphyu'), `[${tag}] admin sees pending Project Watcher suggestions`);
    await page.click('#briefing-generate');
    await page.waitForSelector('#briefing-body h4');
    check((await page.textContent('#briefing-body')).includes('Sub-Saharan Africa'), `[${tag}] briefing generated and shown`);
    await page.click('#review-list [data-review="approved"]');
    await page.waitForSelector('#review-message.auth__message--success');
    const patchCall = calls.find((c) => c.path === '/rest/suggestions');
    check(patchCall?.body.review_status === 'approved' && patchCall.body.reviewed_by === 'user-1' && patchCall.query.includes('id=eq.s1'), `[${tag}] approving records the reviewer`);
    await page.click('#watch-run');
    await page.waitForFunction(() => document.querySelector('#review-message')?.textContent?.includes('started'));
    check(calls.some((c) => c.path === '/api/watch/run' && c.authed), `[${tag}] admin can start the Project Watcher`);
    await page.screenshot({ path: `${outDir}/${tag}-profile-agents.png` });
    await page.click('#profile-close');

    // ---- Agent 4 admin controls, and approved updates on project panels ----
    await page.waitForSelector('[data-news-run]');
    await page.click('[data-news-run]');
    await page.waitForFunction(() => document.querySelector('.news__admin')?.textContent?.includes('Started'));
    check(calls.some((c) => c.path === '/api/news/run' && c.authed), `[${tag}] admin can start the news agent`);
    await page.click('[data-news-filter="bri"]');
    check((await page.locator('.news-item').count()) === 2, `[${tag}] news "Belt and Road only" filter works`);
    await page.locator('#news').screenshot({ path: `${outDir}/${tag}-news.png` });
    await page.click('[data-news-country="KEN"]');
    await page.waitForFunction(() => document.querySelector('.detail__title')?.textContent === 'Kenya');
    check(true, `[${tag}] news country chip opens the country on the map`);
    await page.evaluate(() => window.bri.store.set({ selection: { kind: 'project', id: 'east-coast-rail-link' } }));
    await page.waitForSelector('.callout--update');
    check((await page.textContent('.callout--update')).includes('northern section'), `[${tag}] approved update shown on the project panel`);
    await page.click('[data-close-detail]');

    // ---- Save a country and a project from the map panels ----
    await page.evaluate(() => window.bri.store.set({ selection: { kind: 'country', iso3: 'KEN' } }));
    await page.waitForSelector('[data-save-toggle]:not([disabled])');
    await page.click('[data-save-toggle]');
    await page.waitForSelector('[data-save-toggle][aria-pressed="true"]');
    await page.evaluate(() => window.bri.store.set({ selection: { kind: 'project', id: 'mombasa-nairobi-sgr' } }));
    await page.waitForSelector('[data-save-toggle][aria-pressed="false"]');
    await page.click('[data-save-toggle]');
    await page.waitForSelector('[data-save-toggle][aria-pressed="true"]');
    const savedPatch = calls.filter((c) => c.method === 'PATCH' && c.body?.saved_items).at(-1);
    check(savedPatch?.body.saved_items.length === 2, `[${tag}] saved items stored in profile (${JSON.stringify(savedPatch?.body.saved_items)})`);
    await page.click('[data-close-detail]');
    await page.click('[data-open-profile]');
    await page.waitForSelector('#profile-saved [data-go-kind="country"]');
    const savedText = await page.textContent('#profile-saved');
    check(savedText.includes('Kenya') && savedText.includes('Mombasa'), `[${tag}] profile lists saved items`);
    await page.screenshot({ path: `${outDir}/${tag}-profile-saved.png` });
    await page.click('#profile-saved [data-go-kind="country"]');
    await page.waitForFunction(() => document.querySelector('.detail__title')?.textContent === 'Kenya');
    check(true, `[${tag}] clicking a saved item opens it on the map`);
    await page.click('[data-close-detail]');
    await page.click('[data-open-profile]');
    await page.click('#profile-saved [data-unsave-kind="country"]');
    await page.waitForFunction(() => document.querySelectorAll('#profile-saved [data-go-kind]').length === 1);
    check(true, `[${tag}] saved item can be removed`);
    await page.click('#profile-close');
    check(await page.evaluate(() => window.bri?.store.get().user?.email) === EMAIL, `[${tag}] user stored in app state`);
    await page.screenshot({ path: `${outDir}/${tag}-signed-in.png` });

    // Session persists across reload
    await page.reload();
    await page.waitForSelector('[data-sign-out]');
    check(true, `[${tag}] session persists after reload`);

    // Sign out
    await page.click('[data-sign-out]');
    await page.waitForSelector('[data-sign-in]');
    check(await page.evaluate(() => window.bri.store.get().profile === null), `[${tag}] profile cleared on sign-out`);
    await page.evaluate(() => window.bri.store.set({ selection: { kind: 'country', iso3: 'KEN' } }));
    await page.waitForSelector('[data-save-login]');
    check(true, `[${tag}] signed-out panel offers "Sign in to save"`);
    await page.evaluate(() => window.bri.store.set({ selection: null }));
    check(calls.some((c) => c.path === '/logout'), `[${tag}] sign out calls Supabase and resets header`);

    // Sign up → confirmation message, redirect back to this site
    await page.click('[data-sign-in]');
    await page.click('[data-mode="sign-up"]');
    check((await page.textContent('#auth-title')) === 'Create an account', `[${tag}] can switch to sign-up`);
    await page.fill('#auth-email', 'new@example.com');
    await page.fill('#auth-password', 'short');
    await page.click('#auth-submit');
    check(!calls.some((c) => c.path === '/signup'), `[${tag}] passwords under 8 characters are rejected before calling Supabase`);
    await page.fill('#auth-password', 'long-enough-pw');
    await page.click('#auth-submit');
    await page.waitForSelector('.auth__message--success');
    const signup = calls.find((c) => c.path === '/signup');
    check(signup && decodeURIComponent(signup.query).includes(`redirect_to=${URL}`), `[${tag}] sign-up email links back to this site (${signup && decodeURIComponent(signup.query)})`);
    check((await page.textContent('#auth-message')).includes('new@example.com'), `[${tag}] sign-up asks user to confirm email`);
    await page.screenshot({ path: `${outDir}/${tag}-signup.png` });

    // Forgot password
    await page.click('[data-mode="sign-in"]');
    await page.click('[data-mode="forgot"]');
    check(await page.locator('#auth-password-row').isHidden(), `[${tag}] reset form hides password field`);
    await page.fill('#auth-email', EMAIL);
    await page.click('#auth-submit');
    await page.waitForSelector('.auth__message--success');
    check(calls.some((c) => c.path === '/recover'), `[${tag}] reset request sent`);
    await page.keyboard.press('Escape');

    // Recovery link → "Choose a new password" → updateUser
    // Email links open as a fresh page load.
    await page.goto('about:blank');
    await page.goto(`${URL}#access_token=${jwt}&refresh_token=refresh-2&expires_in=3600&expires_at=${exp}&token_type=bearer&type=recovery`);
    await page.waitForSelector('#auth-dialog[open]');
    check((await page.textContent('#auth-title')) === 'Choose a new password', `[${tag}] reset link opens new-password form`);
    await page.fill('#auth-password', 'brand-new-password');
    await page.click('#auth-submit');
    await page.waitForFunction(() => !document.querySelector('#auth-dialog').open);
    check(calls.some((c) => c.method === 'PUT' && c.path === '/user' && c.body?.password === 'brand-new-password'), `[${tag}] new password saved`);

    // Expired link → message
    await page.goto('about:blank');
    await page.goto(`${URL}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await page.waitForSelector('.auth__message--error');
    check((await page.textContent('#auth-message')).includes('expired'), `[${tag}] expired email link shows a message`);

    check(errors.length === 0, `[${tag}] no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll auth checks passed');
