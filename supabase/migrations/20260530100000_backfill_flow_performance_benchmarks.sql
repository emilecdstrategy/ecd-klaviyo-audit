-- Align stored flow_performance benchmark columns with canonical ECD bands.
-- UI resolves benchmarks from flow_name at render time; this keeps DB rows consistent.

update public.flow_performance fp
set
  benchmark_open_rate_low = 0.25,
  benchmark_open_rate_high = 0.45,
  benchmark_click_rate_low = 0.02,
  benchmark_click_rate_high = 0.05,
  benchmark_conv_rate_low = case
    when fp.flow_name ~* 'review\s*request|review\s*follow|feedback|survey|nps|sunset|list\s*clean|order\s*confirm|order\s*notif|shipping|delivery|fulfillment|transactional|password\s*reset|account\s*confirm|double\s*opt'
      then 0
    when fp.flow_name ~* 'abandon(ed)?\s*(cart|checkout)|cart\s*abandon|checkout\s*abandon|checkout\s*recovery|browse\s*abandon'
      then 0.02
    else 0.01
  end,
  benchmark_conv_rate_high = case
    when fp.flow_name ~* 'review\s*request|review\s*follow|feedback|survey|nps|sunset|list\s*clean|order\s*confirm|order\s*notif|shipping|delivery|fulfillment|transactional|password\s*reset|account\s*confirm|double\s*opt'
      then 0
    when fp.flow_name ~* 'abandon(ed)?\s*(cart|checkout)|cart\s*abandon|checkout\s*abandon|checkout\s*recovery|browse\s*abandon'
      then 0.06
    else 0.03
  end;
