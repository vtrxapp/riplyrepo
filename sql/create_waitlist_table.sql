create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  university text,
  role text not null default 'student' check (role in ('student', 'admin')),
  source text not null default 'landing' check (source in ('landing')),
  created_at timestamptz not null default now()
);

-- A plain UNIQUE constraint on `email` is case-sensitive, so
-- "Test@school.edu" and "test@school.edu" would dedupe as two different
-- rows. Indexing lower(email) instead catches that without needing the
-- citext extension.
create unique index if not exists waitlist_email_lower_uniq
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

-- Anonymous visitors can join the waitlist but can never read it back --
-- this is a public marketing form, not an authenticated app surface, so
-- there's no "own row" concept to scope a select policy to. Re-runnable via
-- drop-then-create, matching the repo's other SQL bootstrap scripts.
drop policy if exists waitlist_insert on public.waitlist;
create policy waitlist_insert on public.waitlist
  for insert to anon
  with check (true);
