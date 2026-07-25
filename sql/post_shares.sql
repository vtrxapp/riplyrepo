-- ─────────────────────────────────────────────
-- Share tracking for group posts, mirroring event_shares/toggleLike
-- ─────────────────────────────────────────────
-- Posts had no share count at all (unlike events, which track shares_count +
-- a per-user event_shares row). This adds the same one-way, "can't un-share"
-- model to posts: post_shares records which users have already shared, and
-- shares_count is kept as a real, atomically-maintained live counter (via
-- the trigger below) rather than a client-side-only optimistic guess, so
-- every viewer sees the same accurate number.
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

-- A sharer can see their own share row; a post's author can see every share
-- of their own post (so they know who shared it) -- but a stranger can't
-- enumerate anyone else's sharing activity across the table the way a plain
-- `using (true)` would allow.
create policy post_shares_select on public.post_shares for select
  using (
    current_user_id() = user_id
    or exists (select 1 from public.posts p where p.id = post_shares.post_id and p.user_id = current_user_id())
  );
create policy post_shares_insert on public.post_shares for insert with check (current_user_id() = user_id);
create policy post_shares_update on public.post_shares for update
  using (current_user_id() = user_id) with check (current_user_id() = user_id);
create policy post_shares_delete on public.post_shares for delete using (current_user_id() = user_id);

-- Every new share row bumps the post's shares_count exactly once, atomically,
-- server-side -- so the count is real and consistent for every viewer instead
-- of only ever reflecting "+1 if I personally shared it" on the client.
create or replace function public.increment_post_shares_count() returns trigger
language plpgsql as $$
begin
  update posts set shares_count = coalesce(shares_count, 0) + 1 where id = NEW.post_id;
  return NEW;
end;
$$;

drop trigger if exists on_post_share on post_shares;
create trigger on_post_share
  after insert on post_shares
  for each row execute function public.increment_post_shares_count();
