-- Optional client context for audits (meeting notes, background, custom instructions for AI refinement).
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS context jsonb DEFAULT NULL;

COMMENT ON COLUMN public.audits.context IS 'JSON: meeting_notes, client_background, custom_instructions (optional AI refinement inputs)';
