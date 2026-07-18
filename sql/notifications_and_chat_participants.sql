-- ─────────────────────────────────────────────
-- chat_participants table
-- ─────────────────────────────────────────────
create table if not exists chat_participants (
  chat_id   uuid references chats(id) on delete cascade,
  user_id   text not null,
  joined_at timestamptz default now(),
  primary key (chat_id, user_id)
);

-- Add last_message columns to chats if missing
alter table chats add column if not exists last_message      text;
alter table chats add column if not exists last_message_at   timestamptz;

-- RLS stays enabled -- see sql/rls_policies.sql for the real per-user
-- policies. (This file used to disable RLS here entirely; caught in review
-- as a silent trap for any environment that re-runs this bootstrap script
-- without also re-applying rls_policies.sql afterward.)
alter table chat_participants enable row level security;

-- ─────────────────────────────────────────────
-- notifications table
-- ─────────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  type       text not null,   -- like | comment | event | group | space | message | ticket
  title      text,
  body       text,
  read       boolean default false,
  created_at timestamptz default now()
);

-- RLS stays enabled -- see sql/rls_policies.sql for the real per-user
-- policies (same reasoning as chat_participants above).
alter table notifications enable row level security;

-- ─────────────────────────────────────────────
-- Trigger: notify on post like
-- ─────────────────────────────────────────────
create or replace function notify_post_like() returns trigger language plpgsql as $$
declare
  post_author text;
  liker_name  text;
begin
  select user_id into post_author from posts where id = NEW.post_id;
  select coalesce(name, 'Someone') into liker_name from users where id = NEW.user_id;
  if post_author is not null and post_author <> NEW.user_id then
    insert into notifications(user_id, type, title, body)
    values (post_author, 'like', liker_name || ' liked your post', 'Your post is getting attention!');
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_post_like on post_likes;
create trigger on_post_like
  after insert on post_likes
  for each row execute procedure notify_post_like();

-- ─────────────────────────────────────────────
-- Trigger: notify on comment
-- ─────────────────────────────────────────────
create or replace function notify_comment() returns trigger language plpgsql as $$
declare
  post_author   text;
  commenter_name text;
begin
  select user_id into post_author from posts where id = NEW.post_id;
  select coalesce(name, 'Someone') into commenter_name from users where id = NEW.user_id;
  if post_author is not null and post_author <> NEW.user_id then
    insert into notifications(user_id, type, title, body)
    values (post_author, 'comment', commenter_name || ' commented on your post', coalesce(left(NEW.content, 80), ''));
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_comment on post_comments;
create trigger on_comment
  after insert on post_comments
  for each row execute procedure notify_comment();

-- ─────────────────────────────────────────────
-- Trigger: notify on event RSVP
-- ─────────────────────────────────────────────
create or replace function notify_event_rsvp() returns trigger language plpgsql as $$
declare
  event_author text;
  event_title  text;
  rsvper_name  text;
begin
  select user_id, title into event_author, event_title from events where id = NEW.event_id;
  select coalesce(name, 'Someone') into rsvper_name from users where id = NEW.user_id;
  if event_author is not null and event_author <> NEW.user_id then
    insert into notifications(user_id, type, title, body)
    values (event_author, 'event', rsvper_name || ' is attending your event', coalesce(event_title, 'Your event'));
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_event_rsvp on event_rsvps;
create trigger on_event_rsvp
  after insert on event_rsvps
  for each row execute procedure notify_event_rsvp();

-- ─────────────────────────────────────────────
-- Trigger: notify on new message
-- ─────────────────────────────────────────────
create or replace function notify_new_message() returns trigger language plpgsql as $$
declare
  sender_name text;
  rec         record;
begin
  select coalesce(name, 'Someone') into sender_name from users where id = NEW.sender_id;
  for rec in
    select user_id from chat_participants
    where chat_id = NEW.chat_id and user_id <> NEW.sender_id
  loop
    insert into notifications(user_id, type, title, body)
    values (rec.user_id, 'message', sender_name || ' sent you a message', coalesce(left(NEW.content, 80), '📎 Attachment'));
  end loop;
  return NEW;
end;
$$;

drop trigger if exists on_new_message on messages;
create trigger on_new_message
  after insert on messages
  for each row execute procedure notify_new_message();
