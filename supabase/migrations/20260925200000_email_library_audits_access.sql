-- The Email Library (and the other audit settings tabs) belong to whoever works
-- in Audits, not only admins (Emil, 2026-09-25: Natalia has Audits access but
-- could not open or edit them). The other three tabs save to platform_settings,
-- which any signed-in team member can already update; the Email Library was the
-- one table still restricted to admins. has_app_access('audits') is true for
-- admins and for Members whose Audits box is ticked.
drop policy if exists "Admins can manage industry_email_library" on public.industry_email_library;
drop policy if exists "Audits users can manage industry_email_library" on public.industry_email_library;
create policy "Audits users can manage industry_email_library"
  on public.industry_email_library
  for all
  to authenticated
  using (public.has_app_access('audits'))
  with check (public.has_app_access('audits'));
