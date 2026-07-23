-- ─────────────────────────────────────────────
-- Auto-delete events when they start
-- and spaces when they end
-- Requires pg_cron (enabled in Supabase dashboard:
--   Database → Extensions → pg_cron → Enable)
-- ─────────────────────────────────────────────

-- Add ends_at column to spaces so they can expire too
alter table spaces add column if not exists ends_at timestamptz;

-- Cron job: runs daily at midnight, deletes events once their calendar day
-- has fully passed.
--
-- events.date is a *text* column (from a plain <input type="date">, see
-- CreateEventScreen) holding midnight of the event's day with no time
-- component -- e.g. '2026-07-21'. Two bugs here, found by actually running
-- this against the live database rather than just reading the SQL:
--
-- 1. The original `date < now()` compared a **text** column against a
--    timestamptz using `<`, which has no such operator in Postgres --
--    `select * from cron.job_run_details` showed this job has been
--    failing every single hourly run with "operator does not exist: text
--    < timestamp with time zone" since it was scheduled. It has never
--    actually deleted a single event.
-- 2. Even fixed to compare same-day (`date < date_trunc('day', now())`),
--    the right side is still a timestamptz, so the same type error would
--    persist. Casting `date` to a real `date` needs a regex guard first --
--    a leftover legacy/seed row in this table has date = 'Today' (not
--    parseable as a date at all), and an unguarded `date::date` cast
--    would throw on that row and abort the whole DELETE, silently
--    breaking cleanup for every event rather than just the malformed one.
--
-- Net effect of bug #1: events were never being auto-deleted at all, so
-- that specific mechanism isn't why editing a live event failed --
-- SEE the PR this shipped in for what actually was. Fixing it here
-- regardless since a cron that has silently no-op'd forever, letting
-- every past event accumulate in this table indefinitely, is its own
-- real bug worth closing.
--
-- Schedule changed from hourly to daily: the cutoff (start of today) only
-- moves once every 24h, so an hourly run was doing 23 no-op checks a day
-- once this is fixed.
select cron.schedule(
  'delete-started-events',      -- job name (unique)
  '0 0 * * *',                  -- once a day, at midnight
  $$
    delete from events
    where date is not null
      -- CASE (not `and date ~ regex and date::date < current_date`) --
      -- Postgres doesn't guarantee AND-predicate evaluation order, so a
      -- plain AND could still let the planner try the ::date cast on the
      -- 'Today' row before the regex filter runs. CASE branches are
      -- guaranteed to short-circuit in order, which a plain AND is not.
      and case
            when date ~ '^\d{4}-\d{2}-\d{2}$' then date::date < current_date
            else false
          end;
  $$
);

-- Cron job: runs every hour, deletes spaces whose end time has passed
select cron.schedule(
  'delete-ended-spaces',
  '0 * * * *',
  $$
    delete from spaces
    where ends_at is not null
      and ends_at < now();
  $$
);

-- ─────────────────────────────────────────────
-- To view scheduled jobs:
--   select * from cron.job;
--
-- To remove a job:
--   select cron.unschedule('delete-started-events');
--   select cron.unschedule('delete-ended-spaces');
-- ─────────────────────────────────────────────
