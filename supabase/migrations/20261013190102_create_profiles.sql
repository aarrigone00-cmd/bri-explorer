-- Applied to the Supabase project via the Supabase MCP (migration 20261013190102_create_profiles).
-- Kept here so the schema is versioned with the app. Apply to a new project with:
--   supabase db push   (or paste into the SQL editor)

-- One profile per Supabase Auth user. Users can only read and edit their own row.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  affiliation text check (char_length(affiliation) <= 100),
  region_of_interest text check (char_length(region_of_interest) <= 60),
  bio text check (char_length(bio) <= 500),
  -- Bookmarked map items: [{"kind": "country"|"project"|"record", "id": "..."}]
  saved_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(saved_items) = 'array' and jsonb_array_length(saved_items) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'BRI Explorer user profiles (one per auth user).';

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy: profiles are removed with the auth user (on delete cascade).
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(split_part(coalesce(new.email, ''), '@', 1), 60))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users who signed up before this migration.
insert into public.profiles (id, display_name)
select u.id, left(split_part(coalesce(u.email, ''), '@', 1), 60)
from auth.users u
on conflict (id) do nothing;
