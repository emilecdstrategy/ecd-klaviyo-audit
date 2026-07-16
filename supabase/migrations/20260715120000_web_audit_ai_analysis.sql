/*
  Web audit AI analysis phase: screenshots gain a 'viewport' (above-the-fold)
  variant alongside the existing full-page capture, so the vision model gets a
  legible hero image (full-page shots downscale too far).
*/

ALTER TABLE public.web_page_snapshots
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'full';

DO $$ BEGIN
  ALTER TABLE public.web_page_snapshots
    ADD CONSTRAINT web_page_snapshots_variant_check CHECK (variant IN ('full','viewport'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
