-- ─────────────────────────────────────────────
-- Keep events.likes in sync with the real event_likes rows
-- ─────────────────────────────────────────────
-- Liking an event (Home, Event Details) only ever wrote/deleted a row in the
-- event_likes junction table -- events.likes itself was a static value that
-- never changed, so every screen that reads it directly (the pinned event
-- card and Events-tab list on group/space profiles) never reflected real
-- likes, while Home/Event Details only *looked* right because they add a
-- client-only "+1 if I've liked it" overlay on top of that same stale number.
-- This trigger makes events.likes the real, persisted count so every screen
-- reading it directly shows the truth, not just the screens with their own
-- optimistic overlay.
create or replace function sync_event_likes_count()
returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update events set likes = coalesce(likes, 0) + 1 where id = new.event_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update events set likes = greatest(coalesce(likes, 0) - 1, 0) where id = old.event_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists event_likes_count_insert on event_likes;
create trigger event_likes_count_insert
  after insert on event_likes
  for each row execute function sync_event_likes_count();

drop trigger if exists event_likes_count_delete on event_likes;
create trigger event_likes_count_delete
  after delete on event_likes
  for each row execute function sync_event_likes_count();

-- One-time backfill so existing events.likes values (many of them stale
-- from seed data) reflect the event_likes rows that already exist.
update events e set likes = coalesce((
  select count(*) from event_likes el where el.event_id = e.id
), 0);
