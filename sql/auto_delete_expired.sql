-- ─────────────────────────────────────────────
-- Auto-delete events when they start
-- and spaces when they end
-- Requires pg_cron (enabled in Supabase dashboard:
--   Database → Extensions → pg_cron → Enable)
-- ─────────────────────────────────────────────

-- Add ends_at column to spaces so they can expire too
alter table spaces add column if not exists ends_at timestamptz;

-- Cron job: runs every hour, deletes events whose start time has passed
select cron.schedule(
  'delete-started-events',      -- job name (unique)
  '0 * * * *',                  -- every hour on the hour
  $$
    delete from events
    where date is not null
      and date < now();
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
