-- Run this in the Supabase SQL Editor
--
-- STORAGE BUCKETS (create these in Supabase Dashboard → Storage → New Bucket):
--   1. "post-images"   — public bucket, for post photos
--   2. "attachments"   — public bucket, for file attachments
--   3. "event-covers"  — public bucket, for event cover photos
--   4. "group avatars" — public bucket, for group & user profile photos
--
-- For each bucket, also add an RLS insert policy:
--   Policy name: "Allow authenticated uploads"
--   Allowed operation: INSERT
--   Target roles: authenticated
--   USING expression: (select auth.uid()) is not null
--

-- feedback table (for FeedbackScreen)
create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     text,
  rating      int not null check (rating between 1 and 5),
  category    text,
  message     text not null,
  created_at  timestamptz default now()
);

-- Add extra columns to posts table
alter table posts add column if not exists avatar_url          text;
alter table posts add column if not exists file_url            text;
alter table posts add column if not exists file_name           text;
alter table posts add column if not exists poll_options        jsonb;
alter table posts add column if not exists poll_votes          jsonb default '{}'::jsonb;
alter table posts add column if not exists poll_voter_ids      jsonb default '[]'::jsonb;
alter table posts add column if not exists poll_expires_at    timestamptz;
-- true for auto-generated group announcements (e.g. "New Event Alert") that
-- should always display the group's own name/avatar, never the live profile
-- of whichever member happened to create the event
alter table posts add column if not exists author_is_group    boolean default false;
alter table posts add column if not exists linked_event_id     uuid;
alter table posts add column if not exists linked_event_title  text;
alter table posts add column if not exists linked_event_date   text;
alter table posts add column if not exists linked_event_time   text;

-- post_comments table
create table if not exists post_comments (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references posts(id) on delete cascade,
  user_id         text not null,
  content         text not null,
  author_name     text,
  author_initial  text,
  author_color    text,
  author_avatar_url text,
  reply_to_id     uuid references post_comments(id) on delete set null,
  reply_to_name   text,
  likes_count     int default 0,
  created_at      timestamptz default now()
);
create index if not exists post_comments_post_id_idx on post_comments(post_id);

-- Enable RLS on post_comments and allow all authenticated users to read/insert
alter table post_comments enable row level security;
drop policy if exists "Allow public read comments"  on post_comments;
drop policy if exists "Allow authenticated insert comments" on post_comments;
create policy "Allow public read comments"
  on post_comments for select using (true);
create policy "Allow authenticated insert comments"
  on post_comments for insert to authenticated with check (true);

-- RPC to increment comment count
create or replace function increment_comment_count(post_id_arg uuid)
returns void language sql as $$
  update posts set comment_count = coalesce(comment_count,0) + 1 where id = post_id_arg;
$$;

-- RPC to increment comment likes
create or replace function increment_comment_likes(comment_id_arg uuid)
returns void language sql as $$
  update post_comments set likes_count = coalesce(likes_count,0) + 1 where id = comment_id_arg;
$$;

-- Add profile fields to users table
alter table users add column if not exists university   text;
alter table users add column if not exists year         text;
alter table users add column if not exists program      text;
alter table users add column if not exists avatar_color text;

-- Add extra columns to groups table
alter table groups add column if not exists social_links  jsonb;
alter table groups add column if not exists permissions   jsonb;
alter table groups add column if not exists avatar_url    text;
alter table groups add column if not exists archived      boolean default false;

-- Add group/visibility fields to events table
alter table events add column if not exists group_id  uuid;
alter table events add column if not exists is_public boolean default true;
-- Shared with the admin dashboard, which writes 'pending'/'draft'/'published'.
-- Left nullable (no default) so pre-existing rows keep showing to regular
-- users, who are only shown status IS NULL OR status = 'published'.
alter table events add column if not exists status text;

-- Amount actually charged at purchase time (fee + tax included), captured on
-- the tickets row itself so purchase history stays accurate even if the
-- event's price later changes -- previously nothing recorded this at all.
alter table tickets add column if not exists amount_paid numeric;

-- space_participants table (for SpaceDetailsScreen join)
create table if not exists space_participants (
  space_id    uuid not null,
  user_id     text not null,
  joined_at   timestamptz default now(),
  primary key (space_id, user_id)
);
