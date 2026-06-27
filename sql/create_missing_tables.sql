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
