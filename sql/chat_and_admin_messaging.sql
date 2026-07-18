-- Run this in the Supabase SQL Editor (or via the Supabase MCP apply_migration tool).
--
-- Two things:
--
-- 1. Fixes a real regression from the RLS migration (sql/rls_policies.sql):
--    notify_post_like/notify_comment/notify_event_rsvp/notify_new_message
--    (defined in sql/notifications_and_chat_participants.sql) are triggers
--    that insert a notification for a *different* user than the one whose
--    action fired them. None of them were declared SECURITY DEFINER, so
--    they ran as SECURITY INVOKER -- meaning the notifications_insert RLS
--    policy (self-insert, or group-admin fanout only) silently blocked
--    every one of these notifications, since none of these four cases are
--    a group-admin fanout. This makes them SECURITY DEFINER (their content
--    is fully determined by the trigger's own logic, not arbitrary user
--    input, so bypassing RLS here is safe).
--
-- 2. Adds two SECURITY DEFINER RPCs for chat creation, replacing a chat
--    creation scheme (a "synthetic_id"/"created_by"-keyed lookup in
--    useChat.js's old resolveChat()) that referenced columns the chats
--    table never actually had -- DM creation was completely broken.
--    chat_participants_insert only allows self-insert (see
--    sql/rls_policies.sql), so enrolling *another* party in a new chat
--    needs a security-definer function:
--      - create_direct_chat(other_user_id): student <-> student (or
--        student <-> space host) 1:1 messaging. Finds an existing pure
--        1:1 chat (group_id is null) between the two users, or creates one.
--      - create_admin_thread(group_id): group-admin <-> UMSU-admin shared
--        inbox. One chat per group, scoped to that group's
--        university/campus (derived from the group's own admin's user
--        profile, since groups has no university/campus of its own). Every
--        UMSU admin for that campus (rows in admin_profiles matching) is
--        added as a participant, so any of them can see and reply -- not
--        just whoever was added first.

create or replace function public.notify_post_like() returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.notify_comment() returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.notify_event_rsvp() returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.notify_new_message() returns trigger language plpgsql security definer set search_path = public as $$
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

-- Note: chat_participants has no single-row "this is the pair" shape to put
-- a unique constraint on for 1:1 DMs, so concurrent calls for the same
-- unordered pair are serialized with a transaction-scoped advisory lock
-- instead (caught in review: without it, two concurrent calls could each
-- miss the other's not-yet-committed chat and create duplicate DMs).
create or replace function public.create_direct_chat(p_other_user_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := current_user_id();
  v_chat_id uuid;
  v_lock_key bigint;
begin
  if v_me is null then
    raise exception 'must be signed in';
  end if;
  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'invalid recipient';
  end if;

  v_lock_key := hashtextextended(
    least(v_me, p_other_user_id) || '|' || greatest(v_me, p_other_user_id), 0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  select c.id into v_chat_id
  from public.chats c
  where c.group_id is null
    and exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.user_id = v_me)
    and exists (select 1 from public.chat_participants cp where cp.chat_id = c.id and cp.user_id = p_other_user_id)
    and (select count(*) from public.chat_participants cp where cp.chat_id = c.id) = 2
  limit 1;

  if v_chat_id is not null then
    return v_chat_id;
  end if;

  insert into public.chats default values returning id into v_chat_id;
  insert into public.chat_participants (chat_id, user_id) values (v_chat_id, v_me), (v_chat_id, p_other_user_id)
    on conflict (chat_id, user_id) do nothing;
  return v_chat_id;
end;
$$;

-- Real unique index enforces at most one admin thread per group (caught in
-- review: the previous select-then-insert had the same concurrent-creation
-- race as create_direct_chat).
create unique index if not exists chats_group_id_unique_idx
  on public.chats (group_id) where group_id is not null;

create or replace function public.create_admin_thread(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := current_user_id();
  v_university text;
  v_campus text;
  v_chat_id uuid;
begin
  if v_me is null then
    raise exception 'must be signed in';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = v_me and role in ('admin','owner')
  ) then
    raise exception 'must be an admin of this group';
  end if;

  select u.university, u.campus into v_university, v_campus
  from public.groups g
  join public.users u on u.id = g.admin_id
  where g.id = p_group_id;

  select id into v_chat_id from public.chats where group_id = p_group_id limit 1;
  if v_chat_id is not null then
    insert into public.chat_participants (chat_id, user_id) values (v_chat_id, v_me)
      on conflict (chat_id, user_id) do nothing;
    return v_chat_id;
  end if;

  insert into public.chats (group_id, name) values (p_group_id, 'UMSU Support')
    on conflict (group_id) do nothing
    returning id into v_chat_id;

  if v_chat_id is null then
    -- Lost the race to a concurrent call -- use the thread it created.
    select id into v_chat_id from public.chats where group_id = p_group_id;
  end if;

  insert into public.chat_participants (chat_id, user_id) values (v_chat_id, v_me)
    on conflict (chat_id, user_id) do nothing;

  insert into public.chat_participants (chat_id, user_id)
  select v_chat_id, ap.user_id
  from public.admin_profiles ap
  where (v_university is null or ap.university = v_university)
    and (v_campus is null or ap.campus = v_campus)
  on conflict (chat_id, user_id) do nothing;

  return v_chat_id;
end;
$$;
