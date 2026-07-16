-- Backfill an explicit send_method on existing proposal send events so the
-- activity log can distinguish "emailed to client" from "link shared".
--
-- Emails always recorded recipient data (email_to / email_results); the manual
-- copy-link path recorded { via: 'link' } (and older rows recorded neither, in
-- which case link is the correct default since email never omits email_to).

-- Emailed sends.
update public.proposal_events
set metadata = metadata || jsonb_build_object('send_method', 'email')
where event_type in ('sent', 'resent')
  and (metadata ? 'email_to' or metadata ? 'email_results')
  and coalesce(metadata->>'send_method', '') <> 'email';

-- Link-copy / made-live sends (and any legacy send with no email payload).
update public.proposal_events
set metadata = metadata || jsonb_build_object('send_method', 'link')
where event_type in ('sent', 'resent')
  and not (metadata ? 'email_to' or metadata ? 'email_results')
  and coalesce(metadata->>'send_method', '') = '';
