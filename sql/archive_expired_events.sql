-- ─────────────────────────────────────────────
-- Archive events before deleting them, instead of losing them outright
-- ─────────────────────────────────────────────
-- Both cleanup paths (the 'delete-started-events' cron job in
-- auto_delete_expired.sql, and useEvents.js's client-side opportunistic
-- cleanup on every Home/Events load) used a plain `delete from events`, so a
-- past event's data -- title, description, attendee/like/save counts,
-- whatever feedback existed for it -- was gone the moment its day passed.
-- There's no in-app UI for this table; it exists so the team can still pull
-- up a finished event's data later (for reviews, feedback, or troubleshooting
-- a reported issue) via the Supabase dashboard/SQL editor.
create table if not exists archived_events (
  id          uuid primary key,
  event       jsonb not null,   -- full snapshot of the row at archive time
  title       text,
  group_id    uuid,
  user_id     text,
  event_date  text,
  archived_at timestamptz default now()
);

-- Locked down entirely -- no select/insert/update/delete policies, so
-- PostgREST (and therefore every app client) has zero access. The only way
-- in is archive_expired_events() below (SECURITY DEFINER) or the Supabase
-- dashboard/SQL editor directly.
alter table archived_events enable row level security;

-- SECURITY DEFINER so this can move *any* user's expired events -- events_delete
-- (rls_policies.sql) only lets a user delete their own rows, which is why the
-- client-side cleanup in useEvents.js only ever actually removed the current
-- user's own past events; the real tenant-wide cleanup has only ever
-- happened via the cron job below, which runs as the table owner.
create or replace function public.archive_expired_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with expired as (
    delete from events
    where date is not null
      -- Same CASE-guarded regex check as the cron job in
      -- auto_delete_expired.sql -- a plain AND doesn't guarantee the regex
      -- filter runs before the ::date cast, which throws on the legacy
      -- date = 'Today' seed row.
      and case
            when date ~ '^\d{4}-\d{2}-\d{2}$' then date::date < current_date
            else false
          end
    returning *
  )
  insert into archived_events (id, event, title, group_id, user_id, event_date)
  select id, to_jsonb(expired), title, group_id, user_id, date
  from expired
  on conflict (id) do nothing;
end;
$$;

-- Re-point the existing daily cron job at the archiving function instead of
-- a raw delete. Same job name, so this replaces its command in place rather
-- than scheduling a duplicate.
select cron.schedule(
  'delete-started-events',
  '0 0 * * *',
  $$ select public.archive_expired_events(); $$
);
