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

-- spaces_insert (rls_policies.sql) only ever checked current_user_id() =
-- host_id -- with group_id now a real column, that left any authenticated
-- user free to insert a space claiming an arbitrary group_id, including
-- groups they don't belong to at all, since nothing tied the two together.
-- Require an approved admin/owner membership whenever group_id is set;
-- personal (null group_id) spaces are unaffected.
drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces for insert
  with check (
    current_user_id() = host_id
    and (
      group_id is null
      or exists (
        select 1 from public.group_members gm
        where gm.group_id = spaces.group_id
          and gm.user_id = current_user_id()
          and gm.status = 'approved'
          and gm.role in ('admin', 'owner')
      )
    )
  );
