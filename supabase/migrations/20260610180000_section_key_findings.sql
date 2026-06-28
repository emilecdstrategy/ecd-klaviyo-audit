-- Per-section Key Findings bullet lists (replaces Key Takeaway prose).
ALTER TABLE audit_sections
  ADD COLUMN IF NOT EXISTS key_findings jsonb NOT NULL DEFAULT '{"items":[],"items_hidden":[]}'::jsonb;

-- Backfill from legacy prose fields.
UPDATE audit_sections
SET key_findings = jsonb_build_object(
  'items',
  jsonb_build_array(
    COALESCE(
      NULLIF(trim(human_edited_findings), ''),
      NULLIF(trim(summary_text), '')
    )
  ),
  'items_hidden', '[]'::jsonb
)
WHERE COALESCE(trim(human_edited_findings), trim(summary_text), '') <> ''
  AND (
    key_findings IS NULL
    OR key_findings = '{"items":[],"items_hidden":[]}'::jsonb
    OR jsonb_array_length(COALESCE(key_findings->'items', '[]'::jsonb)) = 0
  );
