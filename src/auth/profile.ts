import type { Store } from '../state/store';
import type { Profile, SavedItem } from '../types';
import { getSupabase } from './supabase';

// Data access for public.profiles. Row Level Security in Supabase guarantees a
// user can only read and write their own row; see supabase/migrations/.

const COLUMNS = 'id, display_name, affiliation, region_of_interest, bio, saved_items, created_at, updated_at';

export type ProfileFields = Pick<Profile, 'display_name' | 'affiliation' | 'region_of_interest' | 'bio'>;

/** Loads the signed-in user's profile, creating it if the signup trigger hasn't. */
export async function loadProfile(store: Store): Promise<Profile | null> {
  const user = store.get().user;
  if (!user) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').select(COLUMNS).eq('id', user.id).maybeSingle();
  if (error) throw error;
  let profile = data as Profile | null;
  if (!profile) {
    const { data: created, error: insertError } = await sb
      .from('profiles')
      .insert({ id: user.id, display_name: user.email.split('@')[0].slice(0, 60) })
      .select(COLUMNS)
      .single();
    if (insertError) throw insertError;
    profile = created as Profile;
  }
  // Ignore a late response if the user signed out or changed meanwhile.
  if (store.get().user?.id !== user.id) return null;
  store.set({ profile: { ...profile, saved_items: Array.isArray(profile.saved_items) ? profile.saved_items : [] } });
  return profile;
}

async function updateProfile(store: Store, patch: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>): Promise<Profile> {
  const user = store.get().user;
  if (!user) throw new Error('You need to be signed in.');
  const sb = await getSupabase();
  const { data, error } = await sb.from('profiles').update(patch).eq('id', user.id).select(COLUMNS).single();
  if (error) throw error;
  store.set({ profile: data as Profile });
  return data as Profile;
}

const clean = (v: string | null, max: number) => {
  const t = (v ?? '').trim().slice(0, max);
  return t ? t : null;
};

export function saveProfileFields(store: Store, fields: ProfileFields): Promise<Profile> {
  return updateProfile(store, {
    display_name: clean(fields.display_name, 60),
    affiliation: clean(fields.affiliation, 100),
    region_of_interest: clean(fields.region_of_interest, 60),
    bio: clean(fields.bio, 500),
  });
}

export const sameItem = (a: SavedItem, b: SavedItem) => a.kind === b.kind && a.id === b.id;

export function isSaved(store: Store, item: SavedItem): boolean {
  return store.get().profile?.saved_items.some((s) => sameItem(s, item)) ?? false;
}

/** Adds or removes a bookmark. Updates the UI immediately and rolls back on failure. */
export async function toggleSaved(store: Store, item: SavedItem): Promise<void> {
  const profile = store.get().profile;
  if (!profile) throw new Error('Your profile is still loading.');
  const before = profile.saved_items;
  const next = before.some((s) => sameItem(s, item)) ? before.filter((s) => !sameItem(s, item)) : [item, ...before].slice(0, 200);
  store.set({ profile: { ...profile, saved_items: next } });
  try {
    await updateProfile(store, { saved_items: next });
  } catch (err) {
    const current = store.get().profile;
    if (current) store.set({ profile: { ...current, saved_items: before } });
    throw err;
  }
}
