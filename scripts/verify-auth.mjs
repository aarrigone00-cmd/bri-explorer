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
      return body.password === 'correct-horse'
        ? json(200, session)
        : json(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (path === '/signup') return json(200, { ...user, email: body.email, email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() });
    if (path === '/recover') return json(200, {});
    if (path === '/logout') return route.fulfill({ status: 204 });
    if (path === '/user') return json(200, user);
    return json(404, { msg: 'not mocked' });
  });
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

    // Correct password → signed in, email in header
    await page.fill('#auth-password', 'correct-horse');
    await page.click('#auth-submit');
    await page.waitForSelector('[data-sign-out]');
    check(!(await page.locator('#auth-dialog[open]').count()), `[${tag}] dialog closes after sign-in`);
    check(vp.name === 'phone' || (await page.textContent('.account__email')) === EMAIL, `[${tag}] header shows signed-in email`);
    check(await page.evaluate(() => window.bri?.store.get().user?.email) === EMAIL, `[${tag}] user stored in app state`);
    await page.screenshot({ path: `${outDir}/${tag}-signed-in.png` });

    // Session persists across reload
    await page.reload();
    await page.waitForSelector('[data-sign-out]');
    check(true, `[${tag}] session persists after reload`);

    // Sign out
    await page.click('[data-sign-out]');
    await page.waitForSelector('[data-sign-in]');
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
