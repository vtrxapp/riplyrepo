-- Run this in the Supabase SQL Editor

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

-- space_participants table (for SpaceDetailsScreen join)
create table if not exists space_participants (
  space_id    uuid not null,
  user_id     text not null,
  joined_at   timestamptz default now(),
  primary key (space_id, user_id)
);
