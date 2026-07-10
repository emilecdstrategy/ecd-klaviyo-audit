-- Optional second client signer on proposals.
-- Signer 1 keeps the existing recipient_name/recipient_email/public_token fields;
-- signer 2 lives in recipient2_* with its own public_token2. A proposal requires
-- signatures from all configured signers (recipient2_email <> '' means 2 required)
-- before client_signed_at is set and the proposal flips to won.

alter table public.proposals
  add column if not exists recipient2_name text not null default '',
  add column if not exists recipient2_email text not null default '',
  add column if not exists public_token2 text unique;

alter table public.proposal_signatures
  add column if not exists signer_index int not null default 1
    check (signer_index in (1, 2));

alter table public.proposal_signatures
  add constraint proposal_signatures_agency_single_signer
    check (role <> 'agency' or signer_index = 1);

-- One signature per (proposal, role, signer slot). Existing rows are distinct on
-- (proposal_id, role) so they remain distinct on the superset key.
alter table public.proposal_signatures
  drop constraint if exists proposal_signatures_proposal_id_role_key;
alter table public.proposal_signatures
  add constraint proposal_signatures_proposal_role_signer_key
    unique (proposal_id, role, signer_index);

-- Tighten the line-item freeze: client_signed_at now only gets set once ALL
-- signers have signed, so line items must also freeze as soon as the FIRST
-- client signature lands (both signers must sign identical content).
create or replace function public.proposal_line_items_block_signed_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_proposal_id uuid;
  is_locked boolean;
begin
  target_proposal_id := coalesce(new.proposal_id, old.proposal_id);
  select (p.client_signed_at is not null)
      or exists (
        select 1 from public.proposal_signatures s
        where s.proposal_id = p.id and s.role = 'client'
      )
    into is_locked
  from public.proposals p
  where p.id = target_proposal_id;
  if is_locked then
    raise exception 'Proposal has been signed; line items are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Freeze the signer roster once any client signature exists: names, emails, and
-- tokens on record can no longer change (previously this lock was frontend-only).
create or replace function public.proposals_block_signer_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.recipient_name is distinct from old.recipient_name
      or new.recipient_email is distinct from old.recipient_email
      or new.recipient2_name is distinct from old.recipient2_name
      or new.recipient2_email is distinct from old.recipient2_email
      or new.public_token is distinct from old.public_token
      or new.public_token2 is distinct from old.public_token2)
    and exists (
      select 1 from public.proposal_signatures s
      where s.proposal_id = old.id and s.role = 'client'
    )
  then
    raise exception 'Proposal has client signatures; signers on record are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proposals_signers_immutable on public.proposals;
create trigger trg_proposals_signers_immutable
  before update on public.proposals
  for each row
  execute function public.proposals_block_signer_mutation();
