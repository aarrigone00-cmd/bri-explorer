import type { Store } from '../state/store';
import type { ThemePreference } from '../types';

const KEY = 'bri-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export const resolveTheme = (pref: ThemePreference): 'light' | 'dark' =>
  pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;

export function initTheme(store: Store): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-option]');

  const apply = () => {
    const { theme, resolvedTheme } = store.get();
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeOption === theme)));
  };
  apply();

  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const theme = b.dataset.themeOption as ThemePreference;
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        /* ignore */
      }
      store.set({ theme, resolvedTheme: resolveTheme(theme) });
    }),
  );
  media.addEventListener('change', () => {
    if (store.get().theme === 'system') store.set({ resolvedTheme: resolveTheme('system') });
  });
  store.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.resolvedTheme !== prev.resolvedTheme) apply();
  });
}
