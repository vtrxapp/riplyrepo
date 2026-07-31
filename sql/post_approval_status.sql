-- ─────────────────────────────────────────────
-- Wire up "Approve posts first" -- previously a no-op toggle
-- ─────────────────────────────────────────────
-- groups.permissions.requireApproval (set from GroupEditScreen's Privacy
-- tab) was saved but never read anywhere -- a member's post always went
-- live immediately regardless of the toggle. This adds the missing
-- posts.status column so the app can hold a member's post as 'pending'
-- until an admin approves it from the Pending Requests screen, instead
-- of just publishing it right away.
alter table public.posts
  add column if not exists status text not null default 'published';
