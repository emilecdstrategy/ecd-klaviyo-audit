ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS proposal_settings jsonb;

UPDATE platform_settings
SET proposal_settings = '{
  "cover": {
    "background_url": null,
    "logo_url": null,
    "tagline": "Lifecycle marketing that compounds."
  },
  "email": {
    "from_name": "ECD Digital Strategy",
    "from_email": null,
    "reply_to": null,
    "team_notification_emails": []
  },
  "defaults": {
    "valid_days": 30
  }
}'::jsonb
WHERE id = 'default' AND proposal_settings IS NULL;
