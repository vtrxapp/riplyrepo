-- Run this in the Supabase SQL Editor (or via the Supabase MCP apply_migration tool).
--
-- Adds a real "when" to go with tickets.status = 'USED', so the new
-- checked-in attendees list (EventManagerScreen -> Check-in -> View list)
-- can show when each person checked in rather than just who.

alter table tickets add column if not exists checked_in_at timestamptz;

create or replace function public.check_in_ticket(p_ticket_id uuid, p_event_id uuid)
returns table(user_name text, access text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if current_user_id() is null then
    raise exception 'must be signed in to check in tickets';
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'ticket not found';
  end if;

  if t.event_id is distinct from p_event_id then
    raise exception 'this ticket is for a different event';
  end if;

  if not exists (select 1 from public.events e where e.id = p_event_id and e.user_id = current_user_id()) then
    raise exception 'not authorized to check in tickets for this event';
  end if;

  if t.status = 'USED' then
    raise exception 'this ticket has already been checked in';
  end if;

  update public.tickets set status = 'USED', checked_in_at = now() where id = p_ticket_id;

  return query select u.name, t.access from public.users u where u.id = t.user_id;
end;
$$;
