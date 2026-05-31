-- Backfill flow_performance benchmark columns for a single audit (canonical ECD bands).
UPDATE public.flow_performance fp
SET
  benchmark_open_rate_low = 0.25,
  benchmark_open_rate_high = 0.45,
  benchmark_click_rate_low = 0.02,
  benchmark_click_rate_high = 0.05,
  benchmark_conv_rate_low = CASE
    WHEN fp.flow_name ~* 'review\s*request|review\s*follow|feedback|survey|nps|sunset|list\s*clean|order\s*confirm|order\s*notif|shipping|delivery|fulfillment|transactional|password\s*reset|account\s*confirm|double\s*opt'
      THEN 0
    WHEN fp.flow_name ~* 'abandon(ed)?\s*(cart|checkout)|cart\s*abandon|checkout\s*abandon|checkout\s*recovery|browse\s*abandon'
      THEN 0.02
    ELSE 0.01
  END,
  benchmark_conv_rate_high = CASE
    WHEN fp.flow_name ~* 'review\s*request|review\s*follow|feedback|survey|nps|sunset|list\s*clean|order\s*confirm|order\s*notif|shipping|delivery|fulfillment|transactional|password\s*reset|account\s*confirm|double\s*opt'
      THEN 0
    WHEN fp.flow_name ~* 'abandon(ed)?\s*(cart|checkout)|cart\s*abandon|checkout\s*abandon|checkout\s*recovery|browse\s*abandon'
      THEN 0.06
    ELSE 0.03
  END
WHERE fp.audit_id = 'd31e7dd1-6080-41b4-a758-2d75a8086557';
