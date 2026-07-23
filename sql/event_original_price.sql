-- Run this in the Supabase SQL Editor (or via the Supabase MCP apply_migration tool).
--
-- Backs the "Reduced Price" badge: original_price is set once at event
-- creation (see CreateEventScreen's insert) and never touched again by
-- edits, so comparing it against the event's current price tells you
-- whether -- and only whether -- the organizer has lowered it since
-- publishing. Nullable/no-op for free events and for any event created
-- before this shipped (no badge shows for those rather than guessing at
-- a fabricated "original" price).

alter table events add column if not exists original_price numeric;
