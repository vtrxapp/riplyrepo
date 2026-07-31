-- ─────────────────────────────────────────────
-- Attribute group-run spaces to the group, not the admin's personal account
-- ─────────────────────────────────────────────
-- Mirrors posts.author_is_group (already set on group event-alert posts,
-- see CreateEventScreen in src/Riply.jsx): a space created from within a
-- group (CreateSpaceScreen with an effective group_id) is now stored with
-- host_text/host_avatar/host_color set to the *group's* name/avatar/color
-- instead of the admin's personal account, and this flag records that so
-- SpaceDetailsScreen's live host-name refresh (which otherwise always
-- overwrote host_text with the current users.name) can skip that overwrite
-- for group-attributed spaces.
alter table public.spaces
  add column if not exists host_is_group boolean not null default false;
