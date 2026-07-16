-- Let proposal-assistant chat messages carry file attachments (e.g. uploaded
-- PDF pitch decks / briefs). Stored as an array of { url, name, media_type,
-- size } objects; the edge function re-attaches them to the model each turn.
alter table public.proposal_agent_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;
