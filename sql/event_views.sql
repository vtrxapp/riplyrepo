-- ─────────────────────────────────────────────
-- Track real event views, for the new Event Analytics screen
-- ─────────────────────────────────────────────
-- Nothing anywhere counted event opens before this -- EventDetailsScreen just
-- read the event and rendered it, no write-back. Add a column plus an RPC
-- (called once per open, from EventDetailsScreen) that increments it.
alter table events add column if not exists views_count int not null default 0;

-- SECURITY DEFINER so any viewer -- not just the event's own creator -- can
-- increment this. events_update (rls_policies.sql) only allows
-- current_user_id() = user_id, so a plain client-side `.update()` from
-- someone browsing another organizer's event would be blocked by RLS. Same
-- pattern as increment_event_attendee_count() (sql/increment_attendee_count.sql)
-- and archive_expired_events() (sql/archive_expired_events.sql).
create or replace function public.increment_event_views(event_id_arg uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update events set views_count = views_count + 1 where id = event_id_arg;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- would let an unauthenticated (anon) caller invoke this SECURITY DEFINER
-- function directly and inflate any organizer's view count without limit.
-- Restrict it to signed-in users only.
revoke all on function public.increment_event_views(uuid) from public;
grant execute on function public.increment_event_views(uuid) to authenticated;
