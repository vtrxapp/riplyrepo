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
alter table posts add column if not exists file_url            text;
alter table posts add column if not exists file_name           text;
alter table posts add column if not exists poll_options        jsonb;
alter table posts add column if not exists poll_votes          jsonb default '{}'::jsonb;
alter table posts add column if not exists poll_voter_ids      jsonb default '[]'::jsonb;
alter table posts add column if not exists linked_event_id     uuid;
alter table posts add column if not exists linked_event_title  text;

-- post_comments table
create table if not exists post_comments (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references posts(id) on delete cascade,
  user_id         text not null,
  content         text not null,
  author_name     text,
  author_initial  text,
  author_color    text,
  created_at      timestamptz default now()
);
create index if not exists post_comments_post_id_idx on post_comments(post_id);

-- Add profile fields to users table
alter table users add column if not exists university text;
alter table users add column if not exists year       text;
alter table users add column if not exists program    text;

-- Add extra columns to groups table
alter table groups add column if not exists social_links  jsonb;
alter table groups add column if not exists permissions   jsonb;
alter table groups add column if not exists avatar_url    text;
alter table groups add column if not exists archived      boolean default false;

-- Add group/visibility fields to events table
alter table events add column if not exists group_id  uuid;
alter table events add column if not exists is_public boolean default true;

-- space_participants table (for SpaceDetailsScreen join)
create table if not exists space_participants (
  space_id    uuid not null,
  user_id     text not null,
  joined_at   timestamptz default now(),
  primary key (space_id, user_id)
);
