ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS core_flow_recommendations jsonb;

UPDATE platform_settings
SET core_flow_recommendations = '{
  "Welcome Series": "4-5 emails, where the signup path (email vs. email + SMS) sets the discount served. Add 2 SMS: an instant offer and a final reminder before it expires.",
  "Browse Abandonment": "2 emails + 1 SMS. Email 1 reminds with the viewed product (no offer), email 2 adds light urgency, and an SMS nudges a few hours later.",
  "Abandoned Cart": "3-4 emails per path (based on purchase history; first-time buyers get a welcome offer), plus up to 2 SMS depending on scope.",
  "Abandoned Checkout": "3-4 emails + 1-2 SMS per path (based on purchase history; first-time buyers get a welcome offer) to recover checkouts that stalled at payment.",
  "Post-Purchase": "Split by purchase history, 3-4 emails per path to drive the next order and build loyalty.",
  "Subscription Lifecycle": "Lifecycle messaging across onboarding, upcoming-charge reminders, and churn/win-back to keep subscribers active and cut cancellations.",
  "Back-in-Stock": "1 email + 1 SMS the moment the item returns, so ready buyers convert first.",
  "Winback / Re-engagement": "1-2 emails + 1 SMS. Standard is 1 email + 1 SMS, adding a softer first email when scope allows before the urgency send.",
  "Sunset / List Cleaning": "1-2 emails over a short window giving disengaged profiles a final chance to re-engage before suppression, protecting deliverability."
}'::jsonb
WHERE id = 'default' AND core_flow_recommendations IS NULL;
