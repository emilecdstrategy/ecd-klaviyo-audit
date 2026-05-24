CREATE TABLE IF NOT EXISTS platform_settings (
  id text PRIMARY KEY DEFAULT 'default',
  annotation_size text NOT NULL DEFAULT 'md',
  annotations_expanded boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS entity_highlight_style text NOT NULL DEFAULT 'purple';

INSERT INTO platform_settings (id, annotation_size, annotations_expanded, entity_highlight_style)
VALUES ('default', 'md', false, 'purple')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_entity_highlight_style_check;
ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_entity_highlight_style_check
  CHECK (entity_highlight_style IN ('purple', 'yellow', 'emerald', 'disabled'));
