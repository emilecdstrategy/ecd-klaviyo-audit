-- Allow viewer_only audit status (share link for logged-in viewers, not anonymous public).
ALTER TABLE audits DROP CONSTRAINT IF EXISTS audits_status_check;
ALTER TABLE audits ADD CONSTRAINT audits_status_check
  CHECK (status IN ('draft', 'in_review', 'viewer_only', 'published'));
