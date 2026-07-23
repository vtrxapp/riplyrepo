-- ─────────────────────────────────────────────
-- Auto-delete events when they start
-- and spaces when they end
-- Requires pg_cron (enabled in Supabase dashboard:
--   Database → Extensions → pg_cron → Enable)
-- ─────────────────────────────────────────────

-- Add ends_at column to spaces so they can expire too
alter table spaces add column if not exists ends_at timestamptz;

-- Cron job: runs every hour, deletes events once their calendar day has
-- fully passed.
--
-- events.date has no time component (it's written from a plain
-- <input type="date">, see CreateEventScreen) -- it's midnight of the
-- event's day. The original `date < now()` here compared that against
-- the current instant, so an event starting at, say, 7pm today was
-- deleted the moment the clock struck midnight that same morning --
-- hours before it happened, and while every other part of the app
-- (EventManagerScreen's eventTab(), useEvents.js's own cleanup query)
-- still considers it "live" for the entire day. Organizers opening the
-- edit screen for a live event later that day would hit a already-deleted
-- row and get bounced back out, which is why editing (e.g. reducing
-- price) looked broken. Comparing against the start of today instead
-- matches that same-day cutoff everywhere else already uses.
select cron.schedule(
  'delete-started-events',      -- job name (unique)
  '0 * * * *',                  -- every hour on the hour
  $$
    delete from events
    where date is not null
      and date < date_trunc('day', now());
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
