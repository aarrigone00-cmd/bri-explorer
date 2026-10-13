import { loadProfile, saveProfileFields, toggleSaved } from '../auth/profile';
import { isSupabaseConfigured } from '../auth/supabase';
import { PROJECT_TYPES } from '../config';
import type { Store } from '../state/store';
import type { Dataset, SavedItem } from '../types';
import { initials } from './auth';
import { $, escapeHtml } from './dom';

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

/**
 * Profile page (a dialog) for the signed-in user: editable details plus the
 * countries, projects and AidData records they have saved from the map.
 */
export function initProfile(data: Dataset, store: Store): void {
  if (!isSupabaseConfigured) return;
  const dialog = $('#profile-dialog') as HTMLDialogElement;
  const form = $('#profile-form') as HTMLFormElement;
  const message = $('#profile-message');
  const savedList = $('#profile-saved');
  const submit = $('#profile-submit') as HTMLButtonElement;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  // Region choices come from the data (World Bank regions used by GFDC).
  const regions = [...new Set(data.participation.map((c) => c.region))].sort();
  (field('region_of_interest') as HTMLSelectElement).innerHTML =
    `<option value="">No preference</option><option>Global</option>` + regions.map((r) => `<option>${escapeHtml(r)}</option>`).join('');

  const countryName = new Map(data.participation.map((c) => [c.iso3, c.name]));
  for (const f of data.world.features) if (f.properties.iso3 && !countryName.has(f.properties.iso3)) countryName.set(f.properties.iso3, f.properties.name);
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const recordById = new Map(data.records.map((r) => [String(r.id), r]));

  function describe(item: SavedItem): { label: string; sub: string; dot: string } | null {
    if (item.kind === 'country') {
      const name = countryName.get(item.id);
      return name ? { label: name, sub: 'Country', dot: 'dot--country' } : null;
    }
    if (item.kind === 'project') {
      const p = projectById.get(item.id);
      return p ? { label: p.name, sub: `Flagship project · ${PROJECT_TYPES[p.type].label}`, dot: `dot--${p.type}` } : null;
    }
    const r = recordById.get(item.id);
    if (!r) return null;
    const m = r.title.match(/\bfor (?:the )?(.+)$/i);
    const label = (m ? m[1] : r.title).replace(/\s*\((?:linked|Linked)[^)]*\)?\s*$/, '');
    return { label, sub: `AidData record #${r.id} · ${countryName.get(r.iso3) ?? r.iso3}`, dot: `dot--${r.type}` };
  }

  const showMessage = (text: string, kind: 'error' | 'success' | 'info' = 'info') => {
    message.textContent = text;
    message.className = `auth__message auth__message--${kind}`;
    message.hidden = !text;
  };

  function fillForm() {
    const { user, profile } = store.get();
    $('#profile-avatar').textContent = initials(profile?.display_name || user?.email.split('@')[0] || '');
    $('#profile-email').textContent = user?.email ?? '';
    $('#profile-since').textContent = `Member since ${fmtDate(user?.createdAt ?? profile?.created_at)}`;
    field('display_name').value = profile?.display_name ?? '';
    field('affiliation').value = profile?.affiliation ?? '';
    field('region_of_interest').value = profile?.region_of_interest ?? '';
    field('bio').value = profile?.bio ?? '';
    updateBioCount();
    form.querySelectorAll('input, textarea, select, button[type="submit"]').forEach((el) => {
      (el as HTMLInputElement).disabled = !profile;
    });
  }

  function renderSaved() {
    const items = store.get().profile?.saved_items ?? [];
    $('#profile-saved-count').textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      savedList.innerHTML = `<li class="muted small profile__empty">Nothing saved yet. Open a country, project or AidData record on the map and choose <strong>Save</strong>.</li>`;
      return;
    }
    savedList.innerHTML = items
      .map((item) => {
        const d = describe(item);
        const label = d?.label ?? `${item.kind} ${item.id}`;
        return `<li class="profile__saved-item">
          <button type="button" class="link-row" data-go-kind="${item.kind}" data-go-id="${escapeHtml(item.id)}" ${d ? '' : 'disabled'}>
            <span class="dot ${d?.dot ?? ''}"></span>
            <span class="link-row__text"><span>${escapeHtml(label)}</span><span class="muted small profile__saved-sub">${escapeHtml(d?.sub ?? 'No longer in the dataset')}</span></span>
          </button>
          <button type="button" class="icon-button icon-button--small" data-unsave-kind="${item.kind}" data-unsave-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(label)} from saved items" title="Remove">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </li>`;
      })
      .join('');
  }

  const bio = field('bio') as HTMLTextAreaElement;
  const updateBioCount = () => {
    $('#profile-bio-count').textContent = `${bio.value.length}/500`;
  };
  bio.addEventListener('input', updateBioCount);

  async function open() {
    if (!store.get().user) return;
    showMessage('');
    fillForm();
    renderSaved();
    if (!dialog.open) dialog.showModal();
    if (!store.get().profile) {
      showMessage('Loading your profile…');
      try {
        await loadProfile(store);
        showMessage('');
      } catch (err) {
        showMessage(`Could not load your profile: ${(err as Error).message}`, 'error');
      }
    }
  }

  document.addEventListener('bri:open-profile', () => void open());
  $('#profile-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    showMessage('');
    try {
      await saveProfileFields(store, {
        display_name: field('display_name').value,
        affiliation: field('affiliation').value,
        region_of_interest: field('region_of_interest').value,
        bio: field('bio').value,
      });
      showMessage('Profile saved.', 'success');
    } catch (err) {
      showMessage(`Could not save: ${(err as Error).message}`, 'error');
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  });

  savedList.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const go = t.closest<HTMLElement>('[data-go-kind]');
    const rm = t.closest<HTMLElement>('[data-unsave-kind]');
    if (rm) {
      try {
        await toggleSaved(store, { kind: rm.dataset.unsaveKind as SavedItem['kind'], id: rm.dataset.unsaveId! });
      } catch (err) {
        showMessage(`Could not update saved items: ${(err as Error).message}`, 'error');
      }
    } else if (go) {
      const kind = go.dataset.goKind as SavedItem['kind'];
      const id = go.dataset.goId!;
      dialog.close();
      store.set({
        selection: kind === 'country' ? { kind, iso3: id } : kind === 'record' ? { kind, id: Number(id) } : { kind, id },
      });
      document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  });

  // Load the profile whenever someone signs in. Deferred so we never call
  // Supabase from inside its own auth-state callback.
  const load = () =>
    setTimeout(() => {
      loadProfile(store).catch((err) => console.error('Could not load profile', err));
    }, 0);
  if (store.get().user) load();
  store.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id) {
      if (s.user) load();
      else if (dialog.open) dialog.close();
    }
    if (s.profile !== prev.profile && dialog.open) {
      // Refill the form only when a different profile arrives, so typing isn't overwritten.
      if (s.profile?.id !== prev.profile?.id) fillForm();
      $('#profile-avatar').textContent = initials(s.profile?.display_name || s.user?.email.split('@')[0] || '');
      renderSaved();
    }
  });
}
