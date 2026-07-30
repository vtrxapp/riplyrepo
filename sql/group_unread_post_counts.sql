-- ─────────────────────────────────────────────
-- Fix: your own post counting as an "unread" notification for yourself
-- ─────────────────────────────────────────────
-- get_group_unread_post_counts() (called from useGroupActivity.js) isn't
-- defined anywhere in this repo -- it was created directly against the
-- database at some point, outside source control. Reported symptom:
-- joining a group and turning on notifications immediately shows "1
-- notification" for the user's own message, which is exactly what happens
-- if the existing definition counts every post created after
-- last_post_read_at without excluding posts the caller themselves wrote.
-- This replaces it with a corrected version scoped the same way
-- useGroupActivity.js expects: one row per group_id with unread_count,
-- for the calling user's own memberships, excluding their own posts.
create or replace function public.get_group_unread_post_counts()
returns table(group_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.group_id, count(*) as unread_count
  from posts p
  join group_members gm
    on gm.group_id = p.group_id
   and gm.user_id = current_user_id()
  where p.created_at > coalesce(gm.last_post_read_at, 'epoch'::timestamptz)
    and p.user_id is distinct from current_user_id()
  group by p.group_id;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default; restrict
-- to signed-in users, same as every other RPC in this schema.
revoke all on function public.get_group_unread_post_counts() from public;
grant execute on function public.get_group_unread_post_counts() to authenticated;
