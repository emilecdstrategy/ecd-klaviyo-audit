-- Make the per-user area checkboxes a real permission, not just a hidden menu.
--
-- app_access (audits / proposals / documents) was enforced only in the
-- frontend: canAccessArea decided what to render, and nothing checked it
-- server-side. RLS distinguished admin from staff and stopped there, so a
-- Member with Documents unchecked could still read and write every document
-- through the API with their own session token. The checkbox looked like a
-- permission and was decoration.
--
-- The rules here mirror src/lib/access.ts exactly, including the important
-- default: a MISSING app_access, or a missing key inside it, means ALLOWED.
-- Rows predate the column, and treating absence as denial would lock the team
-- out on deploy.
create or replace function public.has_app_access(p_area text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      -- Admins can do everything; their checkboxes are ignored so an admin can
      -- never lock themselves out of an area.
      when p.role = 'admin' then true
      -- 'viewer' is the retired pre-roles value: no area access.
      when p.role = 'viewer' then false
      -- Members: granted unless the area is explicitly false.
      else coalesce(p.app_access->>p_area, 'true') <> 'false'
    end
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

grant execute on function public.has_app_access(text) to authenticated;

-- Add the area check to the existing policies WITHOUT restating them.
--
-- Every one of these policies already carries a role predicate, and there are
-- around sixty of them. Retyping each by hand is how a subtle permission bug
-- gets introduced, so instead each policy's current expression is read back from
-- pg_policies and AND-ed with the area check. Whatever a policy checked before,
-- it still checks, plus the area.
--
-- Only DATA tables are gated. Deliberately left open to every staff account,
-- matching the documented model: clients, the line item catalog, contract and
-- template libraries, the industry reference libraries, and the internal
-- settings/telemetry tables.
do $do$
declare
  v_area_tables jsonb := jsonb_build_object(
    'audits', jsonb_build_array(
      'audits', 'audit_sections', 'audit_assets', 'audit_email_design', 'audit_events',
      'annotations', 'recommendations', 'flow_performance', 'health_scores',
      'klaviyo_connections', 'klaviyo_campaign_snapshots', 'klaviyo_flow_snapshots',
      'klaviyo_form_snapshots', 'klaviyo_segment_snapshots', 'klaviyo_reporting_rollups',
      'klaviyo_runs', 'klaviyo_profile_scan_jobs', 'shopify_connections',
      'shopify_data_snapshots', 'web_page_snapshots', 'web_audit_agent_messages'
    ),
    'proposals', jsonb_build_array(
      'proposals', 'proposal_line_items', 'proposal_signatures', 'proposal_events',
      'proposal_agent_conversations', 'proposal_agent_messages'
    ),
    'documents', jsonb_build_array(
      'documents', 'document_signatures', 'document_events',
      'document_agent_conversations', 'document_agent_messages'
    )
  );
  v_area text;
  v_table text;
  v_pol record;
  v_sql text;
begin
  for v_area in select jsonb_object_keys(v_area_tables) loop
    for v_table in select jsonb_array_elements_text(v_area_tables -> v_area) loop
      for v_pol in
        select policyname, cmd, qual, with_check
        from pg_policies
        where schemaname = 'public'
          and tablename = v_table
          -- Only the staff-facing policies. Anything already carrying the area
          -- check is skipped so this migration is safe to re-run.
          and (coalesce(qual, '') like '%profiles%' or coalesce(with_check, '') like '%profiles%')
          and coalesce(qual, '') not like '%has_app_access%'
          and coalesce(with_check, '') not like '%has_app_access%'
      loop
        v_sql := format('alter policy %I on public.%I', v_pol.policyname, v_table);
        if v_pol.qual is not null then
          v_sql := v_sql || format(' using ((%s) and public.has_app_access(%L))', v_pol.qual, v_area);
        end if;
        if v_pol.with_check is not null then
          v_sql := v_sql || format(' with check ((%s) and public.has_app_access(%L))', v_pol.with_check, v_area);
        end if;
        execute v_sql;
        raise notice 'gated %.% (%) for area %', v_table, v_pol.policyname, v_pol.cmd, v_area;
      end loop;
    end loop;
  end loop;
end
$do$;
