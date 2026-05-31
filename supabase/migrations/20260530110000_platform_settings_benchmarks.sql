ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS benchmarks jsonb;

UPDATE platform_settings
SET benchmarks = '{
  "openRateLow": 0.25,
  "openRateHigh": 0.45,
  "clickRateLow": 0.02,
  "clickRateHigh": 0.05,
  "recoveryConvLow": 0.02,
  "recoveryConvHigh": 0.06,
  "standardConvLow": 0.01,
  "standardConvHigh": 0.03,
  "accountConvLow": 0.01,
  "accountConvHigh": 0.03,
  "bounceHealthyMax": 0.02,
  "bounceWarningMax": 0.05,
  "spamHealthyMax": 0.001,
  "spamWarningMax": 0.003
}'::jsonb
WHERE id = 'default' AND benchmarks IS NULL;
