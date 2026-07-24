create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  university text,
  source text default 'landing',
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Anonymous visitors can join the waitlist but can never read it back --
-- this is a public marketing form, not an authenticated app surface, so
-- there's no "own row" concept to scope a select policy to.
create policy waitlist_insert on public.waitlist
  for insert to anon
  with check (true);
