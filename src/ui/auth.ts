import type { AuthError } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '../auth/supabase';
import type { Store } from '../state/store';
import { $, escapeHtml } from './dom';

type Mode = 'sign-in' | 'sign-up' | 'forgot' | 'new-password';

const TITLES: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create an account',
  forgot: 'Reset your password',
  'new-password': 'Choose a new password',
};
const SUBMIT: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  forgot: 'Send reset link',
  'new-password': 'Save password',
};

const MIN_PASSWORD = 8;

function friendlyError(err: AuthError | Error): string {
  const msg = err.message || 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the confirmation link.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the login service. Check your connection and try again.';
  return msg;
}

export async function initAuth(store: Store): Promise<void> {
  const slot = $('#auth-slot');
  const dialog = $('#auth-dialog') as HTMLDialogElement;
  const form = $('#auth-form') as HTMLFormElement;
  const title = $('#auth-title');
  const message = $('#auth-message');
  const emailRow = $('#auth-email-row');
  const passwordRow = $('#auth-password-row');
  const email = $('#auth-email') as HTMLInputElement;
  const password = $('#auth-password') as HTMLInputElement;
  const submit = $('#auth-submit') as HTMLButtonElement;
  const links = $('#auth-links');

  // Login is optional: without Supabase configuration the site works as before.
  if (!isSupabaseConfigured) {
    slot.hidden = true;
    return;
  }
  // Show the button immediately; the client library loads in the background.
  renderSlot();
  let sb: Awaited<ReturnType<typeof getSupabase>>;
  try {
    sb = await getSupabase();
  } catch (err) {
    console.error('Login unavailable:', err);
    slot.hidden = true;
    return;
  }
  let mode: Mode = 'sign-in';

  const showMessage = (text: string, kind: 'error' | 'success' | 'info' = 'info') => {
    message.textContent = text;
    message.className = `auth__message auth__message--${kind}`;
    message.hidden = !text;
  };

  function setMode(next: Mode) {
    mode = next;
    title.textContent = TITLES[mode];
    submit.textContent = SUBMIT[mode];
    emailRow.hidden = mode === 'new-password';
    passwordRow.hidden = mode === 'forgot';
    email.required = mode !== 'new-password';
    password.required = mode !== 'forgot';
    password.autocomplete = mode === 'sign-in' ? 'current-password' : 'new-password';
    password.minLength = mode === 'sign-in' ? 0 : MIN_PASSWORD;
    $('#auth-password-hint').hidden = mode === 'sign-in' || mode === 'forgot';
    links.innerHTML =
      mode === 'sign-in'
        ? `<button type="button" class="inline-link" data-mode="forgot">Forgot password?</button>
           <span>No account? <button type="button" class="inline-link" data-mode="sign-up">Create one</button></span>`
        : mode === 'new-password'
          ? ''
          : `<span>Already have an account? <button type="button" class="inline-link" data-mode="sign-in">Sign in</button></span>`;
    showMessage('');
  }

  function open(next: Mode = 'sign-in') {
    setMode(next);
    if (!dialog.open) dialog.showModal();
    (mode === 'new-password' ? password : email).focus();
  }

  links.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
    if (m) {
      setMode(m);
      (m === 'new-password' ? password : email).focus();
    }
  });
  $('#auth-close').addEventListener('click', () => dialog.close());
  // Close when clicking the backdrop.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    showMessage('');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    try {
      if (mode === 'sign-in') {
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        dialog.close();
      } else if (mode === 'sign-up') {
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(),
          password: password.value,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (data.session) {
          dialog.close(); // Email confirmation is disabled in Supabase: signed in immediately.
        } else {
          showMessage(`Check ${email.value.trim()} for a confirmation link to finish creating your account.`, 'success');
          password.value = '';
        }
      } else if (mode === 'forgot') {
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo });
        if (error) throw error;
        showMessage('If an account exists for that email, a password reset link is on its way.', 'success');
      } else {
        const { error } = await sb.auth.updateUser({ password: password.value });
        if (error) throw error;
        password.value = '';
        dialog.close();
      }
    } catch (err) {
      showMessage(friendlyError(err as Error), 'error');
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });

  function renderSlot() {
    const user = store.get().user;
    slot.innerHTML = user
      ? `<div class="account">
           <span class="account__email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
           <button type="button" class="chip-button chip-button--small" data-sign-out>Sign out</button>
         </div>`
      : `<button type="button" class="chip-button chip-button--small" data-sign-in>Sign in</button>`;
  }
  slot.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sign-in]')) open('sign-in');
    if (t.closest('[data-sign-out]')) {
      const { error } = await sb.auth.signOut();
      if (error) console.error(error);
    }
  });
  store.subscribe((s, prev) => {
    if (s.user !== prev.user) renderSlot();
  });

  // Errors from expired or reused email links come back in the URL hash.
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const linkError = hash.get('error_description');
  if (linkError) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    open('sign-in');
    showMessage(`${linkError.replace(/\+/g, ' ')}. Please try again.`, 'error');
  }

  sb.auth.onAuthStateChange((event, session) => {
    const u = session?.user;
    store.set({ user: u ? { id: u.id, email: u.email ?? '' } : null });
    if (event === 'PASSWORD_RECOVERY') {
      // Defer: this can fire during client initialisation.
      setTimeout(() => open('new-password'), 0);
    }
  });
}
