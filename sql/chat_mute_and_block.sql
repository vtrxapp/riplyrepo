-- Run this in the Supabase SQL Editor (or via the Supabase MCP apply_migration tool).
--
-- Adds real backing data for the chat "Mute Notifications" and "Block" menu
-- actions (previously just decorative buttons with no logic behind them --
-- see the PR that stripped them from the chat details menu until this
-- landed).

-- ─────────────────────────────────────────────────────────────
-- Mute: per-participant notification silencing. Muting only suppresses the
-- `notifications` row on new messages -- it doesn't affect message
-- delivery/history, so a muted chat still updates normally if you open it.
-- ─────────────────────────────────────────────────────────────
alter table chat_participants add column if not exists muted boolean not null default false;

create or replace function notify_new_message() returns trigger language plpgsql as $$
declare
  sender_name text;
  rec         record;
begin
  select coalesce(name, 'Someone') into sender_name from users where id = NEW.sender_id;
  for rec in
    select user_id from chat_participants
    where chat_id = NEW.chat_id and user_id <> NEW.sender_id and not muted
  loop
    insert into notifications(user_id, type, title, body)
    values (rec.user_id, 'message', sender_name || ' sent you a message', coalesce(left(NEW.content, 80), '📎 Attachment'));
  end loop;
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Block: global and one-directional -- if A blocks B, B can no longer
-- message A in any chat (existing or new), and A's copy of any DM with B is
-- hidden from A's chat list (enforced client-side in useChats.js, not here
-- -- A keeps their own chat_participants row/history so unblocking later
-- doesn't lose anything).
-- ─────────────────────────────────────────────────────────────
create table if not exists blocked_users (
  blocker_id text not null,
  blocked_id text not null,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table blocked_users enable row level security;

drop policy if exists blocked_users_select on public.blocked_users;
drop policy if exists blocked_users_insert on public.blocked_users;
drop policy if exists blocked_users_delete on public.blocked_users;

-- Select is scoped to a user's own outgoing blocks only -- there's no
-- legitimate client read of "who has blocked me" (see is_blocked_in_chat
-- below for how the block is actually enforced without exposing that).
create policy blocked_users_select on public.blocked_users for select
  using (current_user_id() = blocker_id);
create policy blocked_users_insert on public.blocked_users for insert
  with check (current_user_id() = blocker_id);
create policy blocked_users_delete on public.blocked_users for delete
  using (current_user_id() = blocker_id);

-- security definer so this can see *both* sides of a block -- messages_insert
-- below calls this as the sender, who (by blocked_users_select above) can't
-- see rows where they're the one being blocked. A plain EXISTS subquery in
-- the policy itself would silently find nothing and never actually block
-- anyone (the same class of bug called out elsewhere in rls_policies.sql).
create or replace function public.is_blocked_in_chat(p_chat_id uuid, p_sender_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.chat_participants cp
    join public.blocked_users bu on bu.blocker_id = cp.user_id and bu.blocked_id = p_sender_id
    where cp.chat_id = p_chat_id
  );
$$;
revoke all on function public.is_blocked_in_chat(uuid, text) from public, anon;
grant execute on function public.is_blocked_in_chat(uuid, text) to authenticated;

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (
    current_user_id() = sender_id
    and exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = messages.chat_id and cp.user_id = current_user_id()
    )
    and not public.is_blocked_in_chat(messages.chat_id, current_user_id())
  );

-- Closes the obvious loophole: without this, a blocked user could just call
-- create_direct_chat again and start fresh (block is meant to be global, not
-- per-chat). Reuses the same "recipient not found" message as the
-- nonexistent-user case above it so a blocked user can't distinguish "this
-- person doesn't exist" from "this person blocked you".
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
  if not exists (select 1 from public.users where id = p_other_user_id) then
    raise exception 'recipient not found';
  end if;
  if exists (
    select 1 from public.blocked_users
    where blocker_id = p_other_user_id and blocked_id = v_me
  ) then
    raise exception 'recipient not found';
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
