-- ─────────────────────────────────────────────
-- Share tracking for group posts, mirroring event_shares/toggleLike
-- ─────────────────────────────────────────────
-- Posts had no share count at all (unlike events, which track shares_count +
-- a per-user event_shares row). This adds the same one-way, "can't un-share"
-- model to posts: shares_count is a display counter, post_shares records
-- which users have already shared so the client can optimistically add +1
-- without double-counting a repeat tap from the same viewer.
alter table posts add column if not exists shares_count int default 0;

create table if not exists post_shares (
  post_id    uuid not null references posts(id) on delete cascade,
  user_id    text not null,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

alter table post_shares enable row level security;

drop policy if exists post_shares_select on public.post_shares;
drop policy if exists post_shares_insert on public.post_shares;
drop policy if exists post_shares_update on public.post_shares;
drop policy if exists post_shares_delete on public.post_shares;
create policy post_shares_select on public.post_shares for select using (true);
create policy post_shares_insert on public.post_shares for insert with check (current_user_id() = user_id);
create policy post_shares_update on public.post_shares for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy post_shares_delete on public.post_shares for delete using (current_user_id() = user_id);
