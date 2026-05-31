ALTER TABLE public.klaviyo_profile_scan_jobs
  ADD COLUMN IF NOT EXISTS total_profiles integer NOT NULL DEFAULT 0;

ALTER TABLE public.klaviyo_profile_scan_jobs
  ADD COLUMN IF NOT EXISTS sms_subscribed integer NOT NULL DEFAULT 0;
