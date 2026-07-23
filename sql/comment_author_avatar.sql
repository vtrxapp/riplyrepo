-- ─────────────────────────────────────────────
-- Show profile pictures on comments
-- ─────────────────────────────────────────────
-- post_comments denormalizes author_name/author_initial/author_color at
-- insert time (same pattern as posts/messages), but never captured a photo
-- URL -- so the comment section could only ever render an initial circle,
-- never an actual profile picture, no matter what.
alter table post_comments add column if not exists author_avatar_url text;
