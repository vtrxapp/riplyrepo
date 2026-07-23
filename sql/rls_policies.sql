-- Run this in the Supabase SQL Editor (or via the Supabase MCP apply_migration tool).
--
-- Context: every table already has RLS "enabled", but almost all of them carry
-- a blanket `using (true) / with check (true)` policy on every operation —
-- i.e. anyone holding the public anon key (embedded in the client bundle, no
-- login required) can read, insert, update, or delete any row in any table.
-- This replaces those blanket policies with real per-user/per-membership
-- rules, built from an audit of how the app's own client code actually reads
-- and writes each table (so this shouldn't change any legitimate behavior —
-- see the exceptions called out inline below).
--
-- `current_user_id()` already exists (defined as `auth.jwt()->>'sub'`) and is
-- already used by the `users`/`admin_profiles` tables — it resolves to the
-- signed-in Clerk user's id once Supabase is configured to accept Clerk's JWT
-- (Third-Party Auth) and the client passes it via `accessToken` (see the
-- companion change in src/lib/supabase.js). Nothing here touches `users`,
-- `admin_profiles`, `trusted_devices`, or `device_verifications` — the first
-- two already have correct real policies, and the latter two have no client
-- usage at all (device-verification flow isn't implemented in this repo), so
-- they're left fully locked down (RLS enabled, no policies = deny-by-default,
-- service_role still bypasses for the admin dashboard).

-- ─────────────────────────────────────────────────────────────
-- analytics_snapshots — no client usage anywhere in this repo; this is an
-- admin-dashboard metrics table that should never be reachable via the
-- public anon key at all. Drop its open policies entirely (RLS stays
-- enabled with zero policies = deny-by-default; the admin dashboard's own
-- service_role key is unaffected by RLS).
-- ─────────────────────────────────────────────────────────────
drop policy if exists analytics_snapshots_select on public.analytics_snapshots;
drop policy if exists analytics_snapshots_insert on public.analytics_snapshots;
drop policy if exists analytics_snapshots_update on public.analytics_snapshots;
drop policy if exists analytics_snapshots_delete on public.analytics_snapshots;

-- ─────────────────────────────────────────────────────────────
-- groups
-- update is admin-only. The one legitimate cross-user write (any member,
-- not just the admin, incrementing event_count when posting an event to
-- the group) goes through increment_group_event_count() below instead of a
-- direct update, so a non-admin can bump the counter without gaining
-- update rights to the rest of the row (admin_id, privacy, archived, ...).
-- (First cut of this policy was authenticated-only for any update, which
-- review correctly flagged as letting any signed-in user rewrite any
-- group's admin_id/archived/etc.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;

create policy groups_select on public.groups for select using (true);
create policy groups_insert on public.groups for insert
  with check (current_user_id() = admin_id);
create policy groups_update on public.groups for update
  using (current_user_id() = admin_id) with check (current_user_id() = admin_id);
create policy groups_delete on public.groups for delete
  using (current_user_id() = admin_id);

create or replace function public.increment_group_event_count(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_id() is null then
    raise exception 'must be signed in';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = current_user_id()
  ) then
    raise exception 'not a member of this group';
  end if;
  update public.groups set event_count = coalesce(event_count, 0) + 1 where id = p_group_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- events
-- Select mirrors the client's own existing filter convention
-- (.or('status.is.null,status.eq.published')) so draft/pending events are
-- only visible to their creator instead of to anyone with the anon key.
-- Also respects is_public: CreateEventScreen writes is_public: false for
-- group-only events (sourceGroupId set, isPublic unchecked), so a published
-- group-only event is only visible to its creator or a member of that
-- group -- not to every anon-key holder (caught in review: the first cut
-- of this policy checked status but ignored is_public entirely).
-- Requires events.user_id to actually be populated on insert — see the
-- companion fix in Riply.jsx (CreateEventScreen was never setting it).
-- Note: useEvents.js's "delete past events on load" cleanup will now only
-- delete the current user's own past events, not everyone's — that
-- client-triggered mass-delete was already a questionable pattern; a
-- proper fix would move it to a scheduled server-side job.
-- ─────────────────────────────────────────────────────────────
drop policy if exists events_select on public.events;
drop policy if exists events_insert on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;

create policy events_select on public.events for select
  using (
    current_user_id() = user_id
    or (
      (status is null or status = 'published')
      and (
        coalesce(is_public, true)
        or exists (
          select 1 from public.group_members gm
          where gm.group_id = events.group_id and gm.user_id = current_user_id()
        )
      )
    )
  );
create policy events_insert on public.events for insert
  with check (current_user_id() = user_id);
create policy events_update on public.events for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy events_delete on public.events for delete
  using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- spaces — no update/delete call sites found client-side; policies added
-- for completeness/future use, scoped to the host.
-- ─────────────────────────────────────────────────────────────
drop policy if exists spaces_select on public.spaces;
drop policy if exists spaces_insert on public.spaces;
drop policy if exists spaces_update on public.spaces;
drop policy if exists spaces_delete on public.spaces;

create policy spaces_select on public.spaces for select using (true);
create policy spaces_insert on public.spaces for insert
  with check (current_user_id() = host_id);
create policy spaces_update on public.spaces for update
  using (current_user_id() = host_id) with check (current_user_id() = host_id);
create policy spaces_delete on public.spaces for delete
  using (current_user_id() = host_id);

-- ─────────────────────────────────────────────────────────────
-- group_members
-- Self-service (join as member/pending, leave) is always allowed. Beyond
-- that: a group's own admin_id can bootstrap their first membership row at
-- group-creation time, and any existing admin/owner of a group can manage
-- (insert/update/delete) any member row in that same group — this is what
-- already lets an admin promote/demote or remove members client-side today
-- (GroupEditScreen), just never enforced server-side before now. Regular
-- members cannot grant themselves admin/owner via self-insert.
-- ─────────────────────────────────────────────────────────────
drop policy if exists group_members_select on public.group_members;
drop policy if exists group_members_insert on public.group_members;
drop policy if exists group_members_update on public.group_members;
drop policy if exists group_members_delete on public.group_members;

create policy group_members_select on public.group_members for select using (true);

create policy group_members_insert on public.group_members for insert
  with check (
    (current_user_id() = user_id and role in ('member', 'pending'))
    or exists (
      select 1 from public.groups g
      where g.id = group_members.group_id and g.admin_id = current_user_id()
    )
    or exists (
      select 1 from public.group_members gm2
      where gm2.group_id = group_members.group_id
        and gm2.user_id = current_user_id()
        and gm2.role in ('admin', 'owner')
    )
  );

-- with check's self-branch requires role in ('member','pending') -- not just
-- current_user_id() = user_id -- so a plain member can't grant themselves
-- admin/owner by updating their own row (caught in review: the first cut
-- let a self-update through unconditionally, mirroring group_members_insert's
-- self-escalation guard would have prevented on insert but not on update).
create policy group_members_update on public.group_members for update
  using (
    current_user_id() = user_id
    or exists (
      select 1 from public.group_members gm2
      where gm2.group_id = group_members.group_id
        and gm2.user_id = current_user_id()
        and gm2.role in ('admin', 'owner')
    )
  )
  with check (
    (current_user_id() = user_id and role in ('member', 'pending'))
    or exists (
      select 1 from public.group_members gm2
      where gm2.group_id = group_members.group_id
        and gm2.user_id = current_user_id()
        and gm2.role in ('admin', 'owner')
    )
  );

create policy group_members_delete on public.group_members for delete
  using (
    current_user_id() = user_id
    or exists (
      select 1 from public.group_members gm2
      where gm2.group_id = group_members.group_id
        and gm2.user_id = current_user_id()
        and gm2.role in ('admin', 'owner')
    )
  );

-- ─────────────────────────────────────────────────────────────
-- posts
-- Update is owner-only. Poll voting (poll_votes/poll_voter_ids), done by
-- whoever's voting rather than the post's author, goes through
-- cast_post_vote() below instead of a direct update, so a non-owner can
-- vote without gaining update rights to the rest of the post.
-- (First cut of this policy was authenticated-only for any update, which
-- review correctly flagged as letting any signed-in user overwrite anyone
-- else's post content.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists posts_select on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;

create policy posts_select on public.posts for select using (true);
-- A group's "members can post" toggle (groups.permissions->>'membersPost')
-- was only ever checked client-side, so anyone hitting the API directly
-- could post into a group that had it turned off. Enforce it here too:
-- non-group posts are unaffected; group posts require either the poster to
-- be an admin/owner of that group, or the toggle to not be explicitly
-- 'false' (absent/null defaults to allowed, matching the client's default).
create policy posts_insert on public.posts for insert
  with check (
    current_user_id() = user_id
    and (
      group_id is null
      or exists (
        select 1
        from public.group_members gm
        join public.groups g on g.id = gm.group_id
        where gm.group_id = posts.group_id
          and gm.user_id = current_user_id()
          and gm.status = 'approved'
          and (
            gm.role in ('admin', 'owner')
            or coalesce(g.permissions ->> 'membersPost', 'true') <> 'false'
          )
      )
    )
  );
-- Update/delete are also allowed for a group admin/owner of the post's group
-- (not just the author) so group admins can pin/unpin and moderate posts.
-- USING and WITH CHECK are identical here, so WITH CHECK is omitted --
-- Postgres reuses the USING expression for the check when it isn't given.
create policy posts_update on public.posts for update
  using (
    current_user_id() = user_id
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = posts.group_id and gm.user_id = current_user_id() and gm.role in ('admin','owner')
    )
  );
create policy posts_delete on public.posts for delete
  using (
    current_user_id() = user_id
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = posts.group_id and gm.user_id = current_user_id() and gm.role in ('admin','owner')
    )
  );

-- RLS alone can't restrict *which* columns a group admin's update touches --
-- without this trigger an admin could rewrite another member's post
-- text/author via a crafted update instead of just pinning it. Only
-- is_pinned may differ when the updater isn't the post's own author.
create or replace function public.enforce_post_moderation_scope() returns trigger
language plpgsql as $$
begin
  if current_user_id() is distinct from OLD.user_id then
    -- Deliberately excludes likes/likes_count/comments/comment_count and
    -- poll_votes/poll_voter_ids: cast_post_vote() and increment_comment_count()
    -- legitimately update those columns on someone else's post as the acting
    -- (non-author) user, and neither is a moderation/content-integrity risk.
    if NEW.user_id             is distinct from OLD.user_id
       or NEW.group_id         is distinct from OLD.group_id
       or NEW.created_at       is distinct from OLD.created_at
       or NEW.text             is distinct from OLD.text
       or NEW.content          is distinct from OLD.content
       or NEW.image_url        is distinct from OLD.image_url
       or NEW.file_url         is distinct from OLD.file_url
       or NEW.file_name        is distinct from OLD.file_name
       or NEW.poll_options     is distinct from OLD.poll_options
       or NEW.linked_event_id  is distinct from OLD.linked_event_id
       or NEW.linked_event_title is distinct from OLD.linked_event_title
       or NEW.author_id        is distinct from OLD.author_id
       or NEW.author_name      is distinct from OLD.author_name
       or NEW.author_initial   is distinct from OLD.author_initial
       or NEW.author_color     is distinct from OLD.author_color
       or NEW.avatar_url       is distinct from OLD.avatar_url
    then
      raise exception 'group admins may only pin/unpin posts, not edit their content';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists posts_enforce_moderation_scope on public.posts;
create trigger posts_enforce_moderation_scope before update on public.posts
  for each row execute function public.enforce_post_moderation_scope();

-- Deleting a post cascades to its likes/comments instead of failing with a
-- foreign key violation (previously NO ACTION, so any liked/commented post
-- could never be deleted at all).
alter table public.post_likes
  drop constraint if exists post_likes_post_id_fkey,
  add constraint post_likes_post_id_fkey foreign key (post_id) references public.posts(id) on delete cascade;
alter table public.post_comments
  drop constraint if exists post_comments_post_id_fkey,
  add constraint post_comments_post_id_fkey foreign key (post_id) references public.posts(id) on delete cascade,
  drop constraint if exists post_comments_reply_to_id_fkey,
  add constraint post_comments_reply_to_id_fkey foreign key (reply_to_id) references public.post_comments(id) on delete cascade;

create or replace function public.cast_post_vote(p_post_id uuid, p_opt_idx int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  voters jsonb;
  votes  jsonb;
  already_voted boolean;
  expires_at timestamptz;
begin
  if current_user_id() is null then
    raise exception 'must be signed in to vote';
  end if;

  select coalesce(poll_voter_ids, '[]'::jsonb), coalesce(poll_votes, '{}'::jsonb), poll_expires_at
    into voters, votes, expires_at
  from public.posts where id = p_post_id
  for update;

  if not found then
    raise exception 'post not found';
  end if;

  if expires_at is not null and expires_at < now() then
    raise exception 'poll has closed';
  end if;

  select exists (
    select 1 from jsonb_array_elements(voters) v
    where v->>'uid' = current_user_id()
  ) into already_voted;

  if already_voted then
    raise exception 'already voted';
  end if;

  voters := voters || jsonb_build_array(jsonb_build_object('uid', current_user_id(), 'opt', p_opt_idx));
  votes := jsonb_set(
    votes,
    array[p_opt_idx::text],
    to_jsonb(coalesce((votes->>(p_opt_idx::text))::int, 0) + 1),
    true
  );

  update public.posts set poll_voter_ids = voters, poll_votes = votes where id = p_post_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- post_comments
-- ─────────────────────────────────────────────────────────────
drop policy if exists post_comments_select on public.post_comments;
drop policy if exists post_comments_insert on public.post_comments;
drop policy if exists post_comments_update on public.post_comments;
drop policy if exists post_comments_delete on public.post_comments;

create policy post_comments_select on public.post_comments for select using (true);
create policy post_comments_insert on public.post_comments for insert
  with check (current_user_id() = user_id);
create policy post_comments_update on public.post_comments for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy post_comments_delete on public.post_comments for delete
  using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- tickets — purchase records, private to their owner, plus read-only
-- access for the organizer of the event the ticket is for (needed for the
-- Manage Events sales/RSVP dashboard and event check-in).
-- ─────────────────────────────────────────────────────────────
drop policy if exists tickets_select on public.tickets;
drop policy if exists tickets_insert on public.tickets;
drop policy if exists tickets_update on public.tickets;
drop policy if exists tickets_delete on public.tickets;

create policy tickets_select on public.tickets for select using (
  current_user_id() = user_id
  or exists (
    select 1 from public.events e where e.id = tickets.event_id and e.user_id = current_user_id()
  )
);
create policy tickets_insert on public.tickets for insert with check (current_user_id() = user_id);
create policy tickets_update on public.tickets for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy tickets_delete on public.tickets for delete using (current_user_id() = user_id);

-- Event check-in: marks a ticket used. tickets_update above only lets the
-- ticket's own owner update it, so the organizer scanning tickets at the
-- door needs a security-definer function instead of a direct client update
-- -- otherwise we'd have to open tickets_update to "anyone", which would let
-- an organizer edit any field on any attendee's ticket, not just status.
create or replace function public.check_in_ticket(p_ticket_id uuid, p_event_id uuid)
returns table(user_name text, access text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if current_user_id() is null then
    raise exception 'must be signed in to check in tickets';
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket not found';
  end if;

  if t.event_id is distinct from p_event_id then
    raise exception 'this ticket is for a different event';
  end if;

  if not exists (select 1 from public.events e where e.id = p_event_id and e.user_id = current_user_id()) then
    raise exception 'not authorized to check in tickets for this event';
  end if;

  if t.status = 'USED' then
    raise exception 'this ticket has already been checked in';
  end if;

  update public.tickets set status = 'USED' where id = p_ticket_id;

  return query select u.name, t.access from public.users u where u.id = t.user_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- chats / messages — scoped to chat_participants membership.
-- ─────────────────────────────────────────────────────────────
drop policy if exists chats_select on public.chats;
drop policy if exists chats_insert on public.chats;
drop policy if exists chats_update on public.chats;
drop policy if exists chats_delete on public.chats;

create policy chats_select on public.chats for select
  using (exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = chats.id and cp.user_id = current_user_id()
  ));
create policy chats_insert on public.chats for insert with check (current_user_id() is not null);
create policy chats_update on public.chats for update
  using (exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = chats.id and cp.user_id = current_user_id()
  ))
  with check (exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = chats.id and cp.user_id = current_user_id()
  ));
create policy chats_delete on public.chats for delete
  using (exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = chats.id and cp.user_id = current_user_id()
  ));

drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_delete on public.messages;

create policy messages_select on public.messages for select
  using (exists (
    select 1 from public.chat_participants cp
    where cp.chat_id = messages.chat_id and cp.user_id = current_user_id()
  ));
create policy messages_insert on public.messages for insert
  with check (
    current_user_id() = sender_id
    and exists (
      select 1 from public.chat_participants cp
      where cp.chat_id = messages.chat_id and cp.user_id = current_user_id()
    )
  );
create policy messages_update on public.messages for update
  using (current_user_id() = sender_id) with check (current_user_id() = sender_id);
create policy messages_delete on public.messages for delete
  using (current_user_id() = sender_id);

-- ─────────────────────────────────────────────────────────────
-- chat_participants — each user manages their own membership row; select
-- left public (low sensitivity, needed for the chat-membership checks
-- above). Insert additionally requires that the chat doesn't already have
-- a *different* participant, so self-enrolling into an existing chat you
-- weren't part of (e.g. by guessing/learning its UUID) is blocked, while
-- bootstrapping a brand-new chat as its first participant -- the only
-- pattern useChat.js's resolveChat() actually exercises today -- still
-- works. (First cut allowed self-insert into any chat_id unconditionally,
-- which review correctly flagged as letting any signed-in user join any
-- chat and read its messages.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists chat_participants_select on public.chat_participants;
drop policy if exists chat_participants_insert on public.chat_participants;
drop policy if exists chat_participants_update on public.chat_participants;
drop policy if exists chat_participants_delete on public.chat_participants;

create policy chat_participants_select on public.chat_participants for select using (true);
create policy chat_participants_insert on public.chat_participants for insert
  with check (
    current_user_id() = user_id
    and not exists (
      select 1 from public.chat_participants existing
      where existing.chat_id = chat_participants.chat_id
        and existing.user_id <> current_user_id()
    )
  );
create policy chat_participants_update on public.chat_participants for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy chat_participants_delete on public.chat_participants for delete
  using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- notifications — strictly personal to read/update/delete. Insert allows
-- notifying someone else only when they're an admin/owner of a group the
-- inserting user is also a member of -- the one real cross-user pattern
-- (join-request fanout to group admins), everything else must target
-- yourself. (First cut was authenticated-only for any target user_id,
-- which review correctly flagged as a spam/phishing vector: any signed-in
-- user could write notification content into anyone else's feed.)
-- ─────────────────────────────────────────────────────────────
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_update on public.notifications;
drop policy if exists notifications_delete on public.notifications;

create policy notifications_select on public.notifications for select
  using (current_user_id() = user_id);
create policy notifications_insert on public.notifications for insert
  with check (
    current_user_id() = user_id
    or exists (
      select 1
      from public.group_members gm_target
      join public.group_members gm_self
        on gm_self.group_id = gm_target.group_id
      where gm_target.user_id = notifications.user_id
        and gm_target.role in ('admin', 'owner')
        and gm_self.user_id = current_user_id()
    )
  );
create policy notifications_update on public.notifications for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy notifications_delete on public.notifications for delete
  using (current_user_id() = user_id);

-- notifications_insert's group fan-out branch only covers admin-notifying-
-- admin (e.g. new join request) -- it can't cover an admin notifying the
-- regular member whose request they just accepted/declined, since a plain
-- member never satisfies "target is admin/owner". Rather than widen that
-- policy (which would let any group co-member insert a notification for any
-- other co-member, a spam vector), this narrow security-definer RPC lets an
-- admin/owner notify one specific membership decision's target, with the
-- notification's content fully determined server-side.
-- Notifies an event's organizer when someone gets a ticket (paid or free
-- RSVP). Same reasoning as notify_membership_decision above -- the buyer
-- generally isn't a co-admin of any group the organizer belongs to, so
-- notifications_insert's fan-out branch wouldn't cover this; a narrow
-- security-definer RPC with server-derived content instead.
create or replace function public.notify_ticket_purchase(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizer text;
  v_event_title text;
  v_buyer_name text;
begin
  if current_user_id() is null then
    raise exception 'must be signed in';
  end if;

  select user_id, title into v_organizer, v_event_title from public.events where id = p_event_id;
  if v_organizer is null then
    raise exception 'event not found';
  end if;

  -- An organizer buying/RSVPing to their own event shouldn't notify themself.
  if v_organizer = current_user_id() then
    return;
  end if;

  select coalesce(name, 'Someone') into v_buyer_name from public.users where id = current_user_id();

  insert into public.notifications(user_id, type, title, body)
  values (v_organizer, 'ticket', v_buyer_name || ' got a ticket to your event', coalesce(v_event_title, 'Your event'));
end;
$$;

create or replace function public.notify_membership_decision(p_group_id uuid, p_target_user_id text, p_accepted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
begin
  if current_user_id() is null then
    raise exception 'must be signed in';
  end if;
  if not exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = current_user_id()
      and role in ('admin','owner') and status = 'approved'
  ) then
    raise exception 'must be an admin of this group';
  end if;

  select name into v_group_name from public.groups where id = p_group_id;

  insert into public.notifications(user_id, type, title, body)
  values (
    p_target_user_id,
    'group',
    case when p_accepted then 'Request accepted' else 'Request declined' end,
    case when p_accepted
      then format('Your request to join %s was accepted. Welcome!', coalesce(v_group_name, 'the group'))
      else format('Your request to join %s was declined.', coalesce(v_group_name, 'the group'))
    end
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Simple per-user junction/interaction tables: likes, saves, RSVPs, shares.
-- Select left public (who liked/saved something isn't sensitive and is used
-- for counts/existence checks); writes scoped to the acting user's own row.
-- ─────────────────────────────────────────────────────────────
drop policy if exists event_likes_select on public.event_likes;
drop policy if exists event_likes_insert on public.event_likes;
drop policy if exists event_likes_update on public.event_likes;
drop policy if exists event_likes_delete on public.event_likes;
create policy event_likes_select on public.event_likes for select using (true);
create policy event_likes_insert on public.event_likes for insert with check (current_user_id() = user_id);
create policy event_likes_update on public.event_likes for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy event_likes_delete on public.event_likes for delete using (current_user_id() = user_id);

drop policy if exists event_saves_select on public.event_saves;
drop policy if exists event_saves_insert on public.event_saves;
drop policy if exists event_saves_update on public.event_saves;
drop policy if exists event_saves_delete on public.event_saves;
create policy event_saves_select on public.event_saves for select using (true);
create policy event_saves_insert on public.event_saves for insert with check (current_user_id() = user_id);
create policy event_saves_update on public.event_saves for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy event_saves_delete on public.event_saves for delete using (current_user_id() = user_id);

drop policy if exists event_rsvps_select on public.event_rsvps;
drop policy if exists event_rsvps_insert on public.event_rsvps;
drop policy if exists event_rsvps_update on public.event_rsvps;
drop policy if exists event_rsvps_delete on public.event_rsvps;
create policy event_rsvps_select on public.event_rsvps for select using (true);
create policy event_rsvps_insert on public.event_rsvps for insert with check (current_user_id() = user_id);
create policy event_rsvps_update on public.event_rsvps for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy event_rsvps_delete on public.event_rsvps for delete using (current_user_id() = user_id);

drop policy if exists event_shares_select on public.event_shares;
drop policy if exists event_shares_insert on public.event_shares;
drop policy if exists event_shares_update on public.event_shares;
drop policy if exists event_shares_delete on public.event_shares;
create policy event_shares_select on public.event_shares for select using (true);
create policy event_shares_insert on public.event_shares for insert with check (current_user_id() = user_id);
create policy event_shares_update on public.event_shares for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy event_shares_delete on public.event_shares for delete using (current_user_id() = user_id);

drop policy if exists post_likes_select on public.post_likes;
drop policy if exists post_likes_insert on public.post_likes;
drop policy if exists post_likes_update on public.post_likes;
drop policy if exists post_likes_delete on public.post_likes;
create policy post_likes_select on public.post_likes for select using (true);
create policy post_likes_insert on public.post_likes for insert with check (current_user_id() = user_id);
create policy post_likes_update on public.post_likes for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy post_likes_delete on public.post_likes for delete using (current_user_id() = user_id);

drop policy if exists space_participants_select on public.space_participants;
drop policy if exists space_participants_insert on public.space_participants;
drop policy if exists space_participants_update on public.space_participants;
drop policy if exists space_participants_delete on public.space_participants;
create policy space_participants_select on public.space_participants for select using (true);
create policy space_participants_insert on public.space_participants for insert with check (current_user_id() = user_id);
create policy space_participants_update on public.space_participants for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy space_participants_delete on public.space_participants for delete using (current_user_id() = user_id);

drop policy if exists space_saves_select on public.space_saves;
drop policy if exists space_saves_insert on public.space_saves;
drop policy if exists space_saves_update on public.space_saves;
drop policy if exists space_saves_delete on public.space_saves;
create policy space_saves_select on public.space_saves for select using (true);
create policy space_saves_insert on public.space_saves for insert with check (current_user_id() = user_id);
create policy space_saves_update on public.space_saves for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy space_saves_delete on public.space_saves for delete using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- event_reviews — public reviews, owner-managed.
-- ─────────────────────────────────────────────────────────────
drop policy if exists event_reviews_select on public.event_reviews;
drop policy if exists event_reviews_insert on public.event_reviews;
drop policy if exists event_reviews_update on public.event_reviews;
drop policy if exists event_reviews_delete on public.event_reviews;
create policy event_reviews_select on public.event_reviews for select using (true);
create policy event_reviews_insert on public.event_reviews for insert with check (current_user_id() = user_id);
create policy event_reviews_update on public.event_reviews for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy event_reviews_delete on public.event_reviews for delete using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- feedback — private to submitter (nobody browses others' feedback
-- client-side today). Insert allows a null user_id since the client falls
-- back to `user?.id || null`.
-- ─────────────────────────────────────────────────────────────
drop policy if exists feedback_select on public.feedback;
drop policy if exists feedback_insert on public.feedback;
drop policy if exists feedback_update on public.feedback;
drop policy if exists feedback_delete on public.feedback;
create policy feedback_select on public.feedback for select using (current_user_id() = user_id);
create policy feedback_insert on public.feedback for insert
  with check (current_user_id() = user_id or user_id is null);
create policy feedback_update on public.feedback for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy feedback_delete on public.feedback for delete using (current_user_id() = user_id);

-- ─────────────────────────────────────────────────────────────
-- post_reports — real backing for the group "Review Reports" screen and the
-- PostCard "Report Post" action (both were previously hardcoded UI over no
-- actual data).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  reporter_id text not null,
  reason text,
  status text not null default 'open' check (status in ('open','dismissed','removed')),
  created_at timestamptz not null default now()
);
alter table public.post_reports enable row level security;

drop policy if exists post_reports_select on public.post_reports;
drop policy if exists post_reports_insert on public.post_reports;
drop policy if exists post_reports_update on public.post_reports;

create policy post_reports_select on public.post_reports for select using (
  reporter_id = current_user_id()
  or exists (
    select 1 from public.group_members gm
    where gm.group_id = post_reports.group_id and gm.user_id = current_user_id() and gm.role in ('admin','owner')
  )
);
create policy post_reports_insert on public.post_reports for insert with check (reporter_id = current_user_id());
create policy post_reports_update on public.post_reports for update using (
  exists (
    select 1 from public.group_members gm
    where gm.group_id = post_reports.group_id and gm.user_id = current_user_id() and gm.role in ('admin','owner')
  )
);

-- Real backing for "Banned Members" / the new "Ban" member action (group_members
-- already had a `status` column, default 'approved' -- reused here as 'banned'
-- rather than overloading `role`, which drives admin/member/pending semantics).
alter table public.group_members add column if not exists ban_reason text;
alter table public.group_members add column if not exists banned_by text;
alter table public.group_members add column if not exists banned_at timestamptz;

-- posts.images (jsonb array of URLs) — Create Post now supports selecting
-- multiple photos at once; image_url stays populated with the first photo
-- for every existing read site that only ever expected a single image.
alter table public.posts add column if not exists images jsonb;

-- events.is_pinned — lets a group admin pin an event to the top of the
-- group's Events tab, independent of the existing per-post pin feature.
alter table public.events add column if not exists is_pinned boolean not null default false;

-- Server-side enforcement of group bans: the client already blocks a banned
-- user's join button, but the join upsert's RLS only checks
-- current_user_id()/role, not status -- a banned user could otherwise
-- restore their own membership row directly against the API.
create or replace function public.enforce_group_ban() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from public.group_members
    where group_id = NEW.group_id and user_id = NEW.user_id and status = 'banned'
  ) and NEW.status is distinct from 'banned' and current_user_id() = NEW.user_id then
    raise exception 'you have been banned from this group';
  end if;
  return NEW;
end;
$$;

drop trigger if exists group_members_enforce_ban on public.group_members;
create trigger group_members_enforce_ban before insert or update on public.group_members
  for each row execute function public.enforce_group_ban();
