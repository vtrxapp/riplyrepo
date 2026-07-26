-- ─────────────────────────────────────────────
-- Actually increment/decrement events.attendee_count on ticket changes
-- ─────────────────────────────────────────────
-- attendee_count is set to 0 at event creation and was never touched again
-- anywhere -- client or server -- so the "going" count on every event card
-- has always shown 0/stale regardless of how many tickets were sold.
-- TicketsScreen's saveTicket() already inserts a row into `tickets` on a
-- successful purchase (free RSVP or paid), so hook the count off that.

-- A purchase for qty > 1 only ever inserted a single tickets row (covering
-- the whole order via amount_paid) -- there was no column recording how many
-- people that one row actually represents, so a flat +1 per insert would
-- undercount any multi-ticket purchase.
alter table tickets add column if not exists qty int not null default 1;

-- SECURITY DEFINER so this can update *any* user's event -- events_update
-- (rls_policies.sql) only allows `current_user_id() = user_id`, so without
-- this a ticket purchase/cancellation by anyone other than the event's own
-- creator would have this trigger's UPDATE blocked by RLS, failing the
-- whole insert/delete. Same pattern already used by archive_expired_events()
-- in archive_expired_events.sql. `set search_path = public` pins name
-- resolution so this SECURITY DEFINER function can't be hijacked by a
-- session-local search_path pointing at an attacker-controlled schema.
create or replace function public.increment_event_attendee_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update events set attendee_count = coalesce(attendee_count, 0) + coalesce(NEW.qty, 1) where id = NEW.event_id;
  return NEW;
end;
$$;

drop trigger if exists on_ticket_purchased on tickets;
create trigger on_ticket_purchased
  after insert on tickets
  for each row execute function public.increment_event_attendee_count();

-- tickets_delete (rls_policies.sql) already lets a ticket's owner delete
-- their own row (e.g. a future cancellation/refund flow) -- without this,
-- attendee_count would only ever go up, permanently overcounting anyone
-- who's ever had a ticket removed.
create or replace function public.decrement_event_attendee_count() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update events set attendee_count = greatest(coalesce(attendee_count, 0) - coalesce(OLD.qty, 1), 0) where id = OLD.event_id;
  return OLD;
end;
$$;

drop trigger if exists on_ticket_cancelled on tickets;
create trigger on_ticket_cancelled
  after delete on tickets
  for each row execute function public.decrement_event_attendee_count();

-- One-time backfill: every ticket sold before this migration ran never
-- counted toward attendee_count, so set it to the real historical total
-- instead of just starting the count fresh from whatever it happens to be
-- (0, in practice) at the moment this runs. Safe to re-run.
update events e
set attendee_count = coalesce((
  select sum(t.qty) from tickets t where t.event_id = e.id
), 0);
