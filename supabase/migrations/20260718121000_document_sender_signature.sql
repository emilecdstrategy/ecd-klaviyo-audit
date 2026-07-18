-- Sender (staff) counter-signature, toggleable per document.
-- Left column = sender (us), right column = recipient. Recipient signing still
-- drives the document's "signed" status; the sender signature is an independent
-- counter-signature added from the app by staff.

alter table public.documents
  add column if not exists sender_signature_enabled boolean not null default false;

-- Distinguish who signed. Existing rows are recipient signatures.
alter table public.document_signatures
  add column if not exists signer_role text not null default 'recipient'
  check (signer_role in ('sender', 'recipient'));

-- Replace one-signature-per-document with one-per-role (sender + recipient).
alter table public.document_signatures drop constraint if exists document_signatures_document_id_key;
create unique index if not exists document_signatures_doc_role_key
  on public.document_signatures (document_id, signer_role);

-- Staff manage their own (sender-role) signatures directly from the app.
-- Recipient-role rows are still written only via the service-role edge function.
drop policy if exists "Staff manage sender signatures" on public.document_signatures;
create policy "Staff manage sender signatures"
  on public.document_signatures for all to authenticated
  using (
    signer_role = 'sender'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  )
  with check (
    signer_role = 'sender'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );
