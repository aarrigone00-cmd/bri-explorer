-- Tables for the BRI Explorer agents. Agent results are written only by the
-- Netlify functions (service role, which bypasses RLS). Browsers get read
-- access to published results and admins can review suggestions.

-- ---- Admins -----------------------------------------------------------------
create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
create policy "Users can see whether they are an admin"
  on public.app_admins for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.app_admins from anon, authenticated;
grant select on public.app_admins to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---- Usage (per-user daily limits) --------------------------------------------
create table public.agent_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent text not null check (agent in ('ask', 'briefing', 'news', 'watch')),
  created_at timestamptz not null default now()
);
create index agent_usage_user_agent_time on public.agent_usage (user_id, agent, created_at desc);
alter table public.agent_usage enable row level security;
create policy "Users can see their own usage"
  on public.agent_usage for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.agent_usage from anon, authenticated;
grant select on public.agent_usage to authenticated;

-- ---- Background agent runs -------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('news', 'watch')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  triggered_by text not null,
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_runs_agent_time on public.agent_runs (agent, started_at desc);
alter table public.agent_runs enable row level security;
create policy "Admins can see agent runs"
  on public.agent_runs for select to authenticated
  using ((select public.is_admin()));
revoke all on public.agent_runs from anon, authenticated;
grant select on public.agent_runs to authenticated;

-- ---- Agent 4: China foreign policy news digests -----------------------------------
create table public.news_digests (
  id uuid primary key default gen_random_uuid(),
  topic text not null default 'china-foreign-policy',
  status text not null default 'running' check (status in ('running', 'ready', 'error')),
  overview text check (char_length(overview) <= 1000),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  search_count integer,
  model text,
  error text,
  run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index news_digests_ready on public.news_digests (status, completed_at desc);
alter table public.news_digests enable row level security;
-- Published digests are public; admins also see running/failed ones.
create policy "Anyone can read published digests"
  on public.news_digests for select to anon, authenticated
  using (status = 'ready' or (select public.is_admin()));
revoke all on public.news_digests from anon, authenticated;
grant select on public.news_digests to anon, authenticated;

-- ---- Agent 2: Project Watcher ------------------------------------------------------
create table public.project_watch_log (
  id bigint generated always as identity primary key,
  project_id text not null,
  run_id uuid references public.agent_runs (id) on delete set null,
  changed boolean not null,
  summary text,
  sources jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);
create index project_watch_log_project_time on public.project_watch_log (project_id, checked_at desc);
alter table public.project_watch_log enable row level security;
create policy "Admins can see the watch log"
  on public.project_watch_log for select to authenticated
  using ((select public.is_admin()));
revoke all on public.project_watch_log from anon, authenticated;
grant select on public.project_watch_log to authenticated;

create table public.project_update_suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  current_status text not null,
  suggested_status text not null check (suggested_status in
    ('operational', 'completed', 'partially-operational', 'under-construction', 'planned', 'suspended', 'cancelled')),
  status_note text check (char_length(status_note) <= 500),
  summary text check (char_length(summary) <= 1000),
  as_of date,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 4),
  model text,
  run_id uuid references public.agent_runs (id) on delete set null,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_update_suggestions_review on public.project_update_suggestions (review_status, project_id, created_at desc);
alter table public.project_update_suggestions enable row level security;
-- Approved updates are shown on the public map; admins see everything.
create policy "Anyone can read approved updates"
  on public.project_update_suggestions for select to anon, authenticated
  using (review_status = 'approved' or (select public.is_admin()));
-- Admins may only change the review fields, and only as themselves.
create policy "Admins can review suggestions"
  on public.project_update_suggestions for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and reviewed_by = (select auth.uid()) and review_status in ('approved', 'rejected'));
revoke all on public.project_update_suggestions from anon, authenticated;
grant select on public.project_update_suggestions to anon, authenticated;
grant update (review_status, reviewed_by, reviewed_at) on public.project_update_suggestions to authenticated;

-- ---- Agent 3: My Briefing -----------------------------------------------------------
create table public.user_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) <= 20000),
  model text,
  created_at timestamptz not null default now()
);
create index user_briefings_user_time on public.user_briefings (user_id, created_at desc);
alter table public.user_briefings enable row level security;
create policy "Users can read their own briefings"
  on public.user_briefings for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.user_briefings from anon, authenticated;
grant select on public.user_briefings to authenticated;

-- The site owner is the first admin.
insert into public.app_admins (user_id)
select id from auth.users where email = 'a.arrigone00@gmail.com'
on conflict do nothing;
