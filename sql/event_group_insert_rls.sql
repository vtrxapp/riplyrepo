-- ─────────────────────────────────────────────
-- Close the same group_id authorization gap CodeRabbit caught on spaces
-- ─────────────────────────────────────────────
-- events_insert (rls_policies.sql) only ever checked current_user_id() =
-- user_id -- nothing tied group_id to actual membership/role, so any
-- authenticated user could insert an event claiming an arbitrary group's
-- id, including groups they don't belong to at all. The client-side
-- picker in CreateEventScreen only ever offers groups the user actually
-- admins, but that's just UI -- without this, a direct API call could
-- bypass it entirely. Personal (null group_id) events are unaffected.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert
  with check (
    current_user_id() = user_id
    and (
      group_id is null
      or exists (
        select 1 from public.group_members gm
        where gm.group_id = events.group_id
          and gm.user_id = current_user_id()
          and gm.status = 'approved'
          and gm.role in ('admin', 'owner')
      )
    )
  );
