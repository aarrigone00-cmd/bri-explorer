-- Move is_admin() out of the API-exposed public schema (Supabase advisor
-- 0028/0029) and index foreign keys (advisor 0001).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()));
$$;
revoke execute on function private.is_admin() from public;
grant execute on function private.is_admin() to anon, authenticated;

drop policy "Admins can see agent runs" on public.agent_runs;
create policy "Admins can see agent runs"
  on public.agent_runs for select to authenticated
  using ((select private.is_admin()));

drop policy "Anyone can read published digests" on public.news_digests;
create policy "Anyone can read published digests"
  on public.news_digests for select to anon, authenticated
  using (status = 'ready' or (select private.is_admin()));

drop policy "Admins can see the watch log" on public.project_watch_log;
create policy "Admins can see the watch log"
  on public.project_watch_log for select to authenticated
  using ((select private.is_admin()));

drop policy "Anyone can read approved updates" on public.project_update_suggestions;
create policy "Anyone can read approved updates"
  on public.project_update_suggestions for select to anon, authenticated
  using (review_status = 'approved' or (select private.is_admin()));

drop policy "Admins can review suggestions" on public.project_update_suggestions;
create policy "Admins can review suggestions"
  on public.project_update_suggestions for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and reviewed_by = (select auth.uid()) and review_status in ('approved', 'rejected'));

drop function public.is_admin();

create index news_digests_run_id on public.news_digests (run_id);
create index project_update_suggestions_run_id on public.project_update_suggestions (run_id);
create index project_update_suggestions_reviewed_by on public.project_update_suggestions (reviewed_by);
create index project_watch_log_run_id on public.project_watch_log (run_id);
