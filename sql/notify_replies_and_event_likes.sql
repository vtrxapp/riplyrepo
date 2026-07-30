-- ─────────────────────────────────────────────
-- Notify on comment replies, and notify group admins on event likes
-- ─────────────────────────────────────────────
-- 1. notify_comment() (sql/chat_and_admin_messaging.sql) only ever notified
--    the post's author, so replying to someone else's comment (post_comments
--    has a reply_to_id/reply_to_name pair for this, sql/create_missing_tables.sql)
--    never notified the commenter being replied to. This redefinition keeps
--    the existing post-author notification and adds a second one to the
--    parent comment's author, skipping it when that's the same person as
--    the post author (already notified above) or the replier themselves.
--
-- 2. Liking an event never notified anyone. For events tied to a group
--    (events.group_id), the group's admins/owners now get a notification --
--    liking an organizer's standalone event still notifies no one, since
--    there's no "group admin" to route it to.
create or replace function public.notify_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare
  post_author    text;
  commenter_name text;
  parent_author  text;
begin
  select user_id into post_author from posts where id = NEW.post_id;
  select coalesce(name, 'Someone') into commenter_name from users where id = NEW.user_id;
  if post_author is not null and post_author <> NEW.user_id then
    insert into notifications(user_id, type, title, body)
    values (post_author, 'comment', commenter_name || ' commented on your post', coalesce(left(NEW.content, 80), ''));
  end if;

  if NEW.reply_to_id is not null then
    select user_id into parent_author from post_comments where id = NEW.reply_to_id;
    if parent_author is not null and parent_author <> NEW.user_id and parent_author <> post_author then
      insert into notifications(user_id, type, title, body)
      values (parent_author, 'comment', commenter_name || ' replied to your comment', coalesce(left(NEW.content, 80), ''));
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.notify_event_like() returns trigger language plpgsql security definer set search_path = public as $$
declare
  liker_name  text;
  event_title text;
  event_group uuid;
  rec         record;
begin
  select title, group_id into event_title, event_group from events where id = NEW.event_id;
  if event_group is null then
    return NEW;
  end if;
  select coalesce(name, 'Someone') into liker_name from users where id = NEW.user_id;
  for rec in
    select user_id from group_members
    where group_id = event_group and role in ('admin', 'owner') and user_id <> NEW.user_id
  loop
    insert into notifications(user_id, type, title, body)
    values (rec.user_id, 'like', liker_name || ' liked ' || coalesce(event_title, 'your event'), 'Your event is getting attention!');
  end loop;
  return NEW;
end;
$$;

drop trigger if exists on_event_like on event_likes;
create trigger on_event_like
  after insert on event_likes
  for each row execute procedure notify_event_like();
