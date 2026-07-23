-- ─────────────────────────────────────────────
-- Enable Realtime for every table the app subscribes to
-- ─────────────────────────────────────────────
--
-- The `supabase_realtime` publication exists on this project but has zero
-- tables added to it (confirmed via `select * from pg_publication_tables
-- where pubname = 'supabase_realtime'` -- empty). Every postgres_changes
-- subscription in the client code (useChat, useChats, usePosts, useComments,
-- useNotifications, useGroups, useGroupActivity, and the checked-in
-- attendees list) has therefore always been a no-op: the initial load still
-- works, but nothing ever pushes live, and features that depend on realtime
-- to trigger a reload (like useChats.js reloading the chat list after
-- useChat.js marks a chat read) silently never update until something else
-- causes a re-render.
--
-- This is very likely the cause of "messages don't register as seen even if
-- I open the chat" -- markRead() does correctly update
-- chat_participants.last_read_at on open, but the chats list has no way to
-- find out that happened, so the unread badge never clears until the whole
-- list component remounts.
alter publication supabase_realtime add table
  messages,
  chats,
  chat_participants,
  blocked_users,
  tickets,
  posts,
  post_comments,
  notifications,
  group_members;
