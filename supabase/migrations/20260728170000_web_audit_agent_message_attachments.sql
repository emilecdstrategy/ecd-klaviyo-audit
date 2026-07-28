-- Image attachments on web-audit assistant messages, same shape as the
-- proposal/document agent columns: [{url, name, media_type, size}].
alter table public.web_audit_agent_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;
