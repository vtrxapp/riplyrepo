-- Adds online-meeting support to events and spaces, so a group/organizer can
-- host a virtual event/space (Zoom, Microsoft Teams, Google Meet, etc.)
-- instead of requiring a physical venue. `meeting_platform` is resolved once
-- client-side at save time (via detectMeetingPlatform in Riply.jsx) and
-- stored directly, so cards/detail screens never need to re-parse the URL.

alter table public.events
  add column if not exists is_online boolean not null default false,
  add column if not exists meeting_link text,
  add column if not exists meeting_platform text;

alter table public.spaces
  add column if not exists is_online boolean not null default false,
  add column if not exists meeting_link text,
  add column if not exists meeting_platform text;
