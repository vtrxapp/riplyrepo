-- ─────────────────────────────────────────────
-- Track real event views, for the new Event Analytics screen
-- ─────────────────────────────────────────────
-- Nothing anywhere counted event opens before this -- EventDetailsScreen just
-- read the event and rendered it, no write-back. Add a running-total column
-- (fast to read anywhere a simple count is needed) plus a per-view log table
-- (needed so the analytics screen's weekly chart can bucket real views by
-- day -- a single running total has no daily breakdown to chart).
alter table events add column if not exists views_count int not null default 0;

create table if not exists public.event_view_events (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists event_view_events_event_id_viewed_at_idx on public.event_view_events (event_id, viewed_at);

alter table public.event_view_events enable row level security;
drop policy if exists event_view_events_select on public.event_view_events;
create policy event_view_events_select on public.event_view_events for select using (
  exists (select 1 from public.events e where e.id = event_view_events.event_id and e.user_id = current_user_id())
);

-- SECURITY DEFINER so any viewer -- not just the event's own creator -- can
-- record a view here. events_update (rls_policies.sql) only allows
-- current_user_id() = user_id, so a plain client-side write from someone
-- browsing another organizer's event would be blocked by RLS. Same pattern
-- as increment_event_attendee_count() (sql/increment_attendee_count.sql)
-- and archive_expired_events() (sql/archive_expired_events.sql).
create or replace function public.increment_event_views(event_id_arg uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update events set views_count = views_count + 1 where id = event_id_arg;
  insert into event_view_events (event_id) values (event_id_arg);
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- would let an unauthenticated (anon) caller invoke this SECURITY DEFINER
-- function directly and inflate any organizer's view count without limit.
-- Restrict it to signed-in users only.
revoke all on function public.increment_event_views(uuid) from public;
grant execute on function public.increment_event_views(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Weekly view buckets, aggregated server-side
-- ─────────────────────────────────────────────
-- The analytics chart used to fetch raw `tickets` rows and bucket them on
-- the client -- besides not being real view data, that also silently
-- truncated at Postgrest's default 1000-row cap for any event popular
-- enough to exceed it. Aggregating with count()/group by here means the
-- client only ever gets back 7 numbers, regardless of how many
-- event_view_events rows exist underneath.
create or replace function public.get_event_view_week_buckets(event_id_arg uuid, week_start_arg timestamptz)
returns table(day_index int, view_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select d.day_index, count(v.id)
  from generate_series(0, 6) as d(day_index)
  left join event_view_events v
    on v.event_id = event_id_arg
   and v.viewed_at >= week_start_arg + (d.day_index || ' days')::interval
   and v.viewed_at <  week_start_arg + ((d.day_index + 1) || ' days')::interval
  group by d.day_index
  order by d.day_index;
$$;

-- SECURITY DEFINER (same reasoning as increment_event_views above) so this
-- can read event_view_events for organizers whose RLS select policy would
-- otherwise only let them query their own rows one at a time -- this still
-- only returns aggregated counts, never raw rows, to any caller.
revoke all on function public.get_event_view_week_buckets(uuid, timestamptz) from public;
grant execute on function public.get_event_view_week_buckets(uuid, timestamptz) to authenticated;

-- ─────────────────────────────────────────────
-- Ticket totals, aggregated server-side
-- ─────────────────────────────────────────────
-- Same 1000-row-cap problem as above applied to the `tickets` table:
-- fetching every ticket row to sum revenue/qty/check-ins on the client
-- silently undercounts any event with more than 1000 ticket rows. Sum it
-- in SQL instead so the client gets back one row regardless of volume.
create or replace function public.get_event_ticket_totals(event_id_arg uuid)
returns table(revenue numeric, total_qty bigint, checked_in_qty bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount_paid), 0),
    coalesce(sum(qty), 0),
    coalesce(sum(qty) filter (where checked_in_at is not null), 0)
  from tickets
  where event_id = event_id_arg;
$$;

revoke all on function public.get_event_ticket_totals(uuid) from public;
grant execute on function public.get_event_ticket_totals(uuid) to authenticated;
