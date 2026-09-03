-- ECD's real fees for the direct mail service, confirmed by Isa on 2026-09-03:
-- $2,500 one-time setup and $500 a month management. The seeded monthly figure
-- was a $1,500 placeholder.
--
-- PostPilot's own platform, printing, postage and data costs sit on top and are
-- billed by PostPilot. We do not publish their rates: their partner document
-- forbids estimating them and requires PostPilot to review any generated
-- deliverable that quotes their pricing.
update public.revenue_opportunity_templates
set
  monthly_price = 500,
  content = E'- Segment build for the unreachable audience (suppressed, unsubscribed, 90-day unengaged with order history) synced from Klaviyo\n- Postcard companions at the end of your existing flows: abandoned cart, welcome, post-purchase, winback\n- Holdout design on every campaign so results are read as incremental ROAS, not attributed revenue\n- PostPilot connection (OAuth, Shopify prerequisite), Event Sync request, creative brief and first two test campaigns\n- Ongoing: monthly readout, cadence and offer tuning, new pairings as flows change\n- PostPilot platform, printing, postage and data costs are billed by PostPilot on top of these fees',
  updated_at = now()
where slug = 'ecd_direct_mail_postpilot';
