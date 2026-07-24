-- ─────────────────────────────────────────────
-- Show a "seen"-style check mark on your own last message in the chat list
-- ─────────────────────────────────────────────
-- Chats previously only stored last_message/last_message_at, with no way to
-- tell who sent it -- the chat list preview looked identical whether you
-- sent the last message or the other person did.
alter table chats add column if not exists last_message_sender_id text;
