-- Direct mail (PostPilot) as an optional add-on on Klaviyo audits.
--
-- The klaviyo_direct_mail function decides per audit whether the numbers
-- support a direct mail program (US brand, a matched audience of 3,000+,
-- break-even under 1.5% of recipients, about $1k a month or more to PostPilot)
-- and, when they do, writes a "direct_mail" report section and adds this
-- template to the audit's add-ons, highlighted, so it flows into the proposal
-- as a line item the strategist can keep or drop.
--
-- The fees are ECD's own (setup and monthly management) and are placeholders
-- to be set in Admin > Services. PostPilot's own costs (subscription, per piece,
-- data) are shown inside the report section from the published rate card and
-- are not part of this line item.
insert into public.revenue_opportunity_templates
  (slug, name, description, content, bullets, default_revenue_monthly, display_order, is_active, audit_type,
   one_time_price, one_time_label, monthly_price, monthly_label)
values (
  'ecd_direct_mail_postpilot',
  'Direct Mail via PostPilot',
  'Reach the profiles email cannot: suppressed, unsubscribed and unengaged customers, through automated postcards paired with your Klaviyo flows.',
  E'- Segment build for the unreachable audience (suppressed, unsubscribed, 90-day unengaged with order history) synced from Klaviyo\n- Postcard companions at the end of your existing flows: abandoned cart, welcome, post-purchase, winback\n- Holdout design on every campaign so results are read as incremental ROAS, not attributed revenue\n- PostPilot connection (OAuth, Shopify prerequisite), Event Sync request, creative brief and first two test campaigns\n- Ongoing: monthly readout, cadence and offer tuning, new pairings as flows change\n- PostPilot subscription, printing, postage and data are billed by PostPilot and shown separately in the report',
  '[]'::jsonb,
  0,
  65,
  true,
  'klaviyo',
  2500,
  'Setup',
  1500,
  'Management'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  content = excluded.content,
  audit_type = excluded.audit_type,
  is_active = true,
  updated_at = now();
