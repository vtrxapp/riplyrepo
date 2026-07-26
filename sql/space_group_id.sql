-- ─────────────────────────────────────────────
-- Let a space be attached to a group, same as events
-- ─────────────────────────────────────────────
-- Spaces had no concept of belonging to a group at all (host_id is just the
-- creating user) -- so there was no way for a group's Spaces tab to exist.
-- on delete set null (not cascade): a space losing its group shouldn't
-- delete the space itself, just un-attach it -- same choice already made
-- for posts.group_id and events.group_id elsewhere in this schema.
alter table spaces add column if not exists group_id uuid references groups(id) on delete set null;
create index if not exists spaces_group_id_idx on public.spaces (group_id);
