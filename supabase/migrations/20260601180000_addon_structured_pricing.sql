-- Structured ECD pricing for revenue opportunity add-on templates.

ALTER TABLE public.revenue_opportunity_templates
  ADD COLUMN IF NOT EXISTS one_time_price numeric,
  ADD COLUMN IF NOT EXISTS one_time_label text,
  ADD COLUMN IF NOT EXISTS monthly_price numeric,
  ADD COLUMN IF NOT EXISTS monthly_label text;

-- Seed pricing and strip redundant pricing copy from template bodies.
UPDATE public.revenue_opportunity_templates SET
  one_time_price = 2500,
  one_time_label = NULL,
  monthly_price = NULL,
  monthly_label = NULL,
  content = '- A branded AI assistant trained on your knowledge base and site voice
- Core skills for order tracking, product recommendations, and discount retrieval
- Escalation rules with web chat plus optional SMS and email response channels
- Post-purchase order edits, cancellations, and tracking within a configurable order window',
  updated_at = now()
WHERE slug = 'klaviyo_customer_agent';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 2500,
  one_time_label = 'Full $2,500 · Mini $500',
  monthly_price = NULL,
  monthly_label = NULL,
  content = '- A clear, always-on view of customer value and lifecycle health
- Automated responses to changes in customer behavior
- Smarter targeting for cross-sell, retention, and reactivation
- Data that directly informs revenue decisions—not just dashboards',
  updated_at = now()
WHERE slug = 'klaviyo_marketing_analytics';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 1000,
  one_time_label = '$1,000–$2,000',
  monthly_price = NULL,
  monthly_label = NULL,
  content = 'Helpdesk is:

- A centralized support system connected to your Klaviyo customer data
- Faster response times with structured workflows and automation
- Improved customer experience across Email, Chat and SMS
- Better visibility into customer issues, behavior, and lifecycle stage',
  updated_at = now()
WHERE slug = 'klaviyo_helpdesk';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 350,
  one_time_label = 'Installation $350 · Full setup $2,050',
  monthly_price = NULL,
  monthly_label = NULL,
  content = '- A personalized shopping and service destination on your site
- Tailored product recommendations powered by Klaviyo data
- Wishlists, order tracking, and customer preferences in one place
- Stronger engagement beyond the inbox',
  updated_at = now()
WHERE slug = 'klaviyo_customer_hub';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 6000,
  one_time_label = NULL,
  monthly_price = NULL,
  monthly_label = NULL,
  content = '4-week implementation timeline

- **Dedicated team:** Account Strategist, Lifecycle Marketing Manager, Graphic Designer, and Copywriter
- Fully built and launched for you
- Done-for-you Shopify integration + guidance on third-party integrations
- List Growth System with optimized popups by device and funnel stage
- Done-for-you domain warm-up process, deliverability review, and warm-up strategy
- Advanced segmentation engine for VIPs, churn-risk, affinity, and predictive behavior
- 7 custom automations focused on personalization, upsells, retention, and replenishment
- 20 custom emails + 10 custom SMS campaigns with original design and on-brand copy',
  updated_at = now()
WHERE slug = 'ecd_full_implementation';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 2500,
  one_time_label = NULL,
  monthly_price = NULL,
  monthly_label = NULL,
  content = '21–30 day implementation timeline

- **Dedicated team:** Account Strategist, Lifecycle Marketing Manager, Graphic Designer, and Copywriter
- Fully built and launched for you
- Done-for-you Shopify integration + guidance on third-party integrations
- List Growth System with optimized popups by device and funnel stage
- Done-for-you domain warm-up process, deliverability review, and warm-up strategy
- Advanced segmentation engine for VIPs, churn-risk, affinity, and predictive behavior
- 3–4 custom automations
- 10 custom emails + 5 custom SMS campaigns with original design and on-brand copy',
  updated_at = now()
WHERE slug = 'ecd_mini_implementation';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = 3000,
  one_time_label = NULL,
  monthly_price = NULL,
  monthly_label = NULL,
  content = 'What Klaviyo Reviews means for your business:
- Increased conversion rates through on-site social proof
- Higher click-through rates on ads and organic listings
- A consistent stream of customer-generated content
- Stronger trust and credibility across your store',
  updated_at = now()
WHERE slug = 'klaviyo_reviews';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = NULL,
  one_time_label = NULL,
  monthly_price = 3000,
  monthly_label = NULL,
  content = '**Timeline:** Monthly ongoing management

**Format:** 100% Done-For-You

***What''s Included:***
- Up to 5 email campaigns per month
- Up to 3–4 SMS campaigns per month
- One monthly strategy call
- Email marketing calendar development
- Full content creation (copywriting, design, and layout)
- Client review, revisions, and approvals
- Email scheduling, testing, and deployment',
  updated_at = now()
WHERE slug = 'ongoing_account_management_tier_1';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = NULL,
  one_time_label = NULL,
  monthly_price = 5500,
  monthly_label = NULL,
  content = '**Timeline:** Monthly ongoing management

**Format:** 100% Done-For-You

***Includes Everything in Tier 1, Plus:***

- Up to 10 email campaigns per month
- Up to 4–5 SMS campaigns per month
- Bi-weekly strategy sessions (up to 1 hour each)
- Full promotional calendar planning
- Monthly performance reporting with insights and recommendations

***Why Upgrade:***
Transition from reactive execution to proactive strategy with a consistent campaign cadence',
  updated_at = now()
WHERE slug = 'ongoing_account_management_tier_2';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = NULL,
  one_time_label = NULL,
  monthly_price = 9000,
  monthly_label = NULL,
  content = '**Timeline:** Monthly ongoing management

**Format:** 100% Done-For-You

***Includes Everything in Tier 2, Plus:***

- Up to 25 email campaigns per month
- Up to 6–7 SMS campaigns per month
- Quarterly strategy sessions (up to 2 hours)
- Continuous A/B testing across campaigns and flows
- Quarterly flow audits for ongoing optimization
- Full popup management, including design updates and testing
- Bug fixes and real-time troubleshooting across email, SMS, and popups

***Why Upgrade:***
Maximize ROI with continuous testing, optimization, and retention-focused improvements',
  updated_at = now()
WHERE slug = 'ongoing_account_management_tier_3';

UPDATE public.revenue_opportunity_templates SET
  one_time_price = NULL,
  one_time_label = NULL,
  monthly_price = 12000,
  monthly_label = '$12,000+/mo',
  content = '**Timeline:** Monthly ongoing management

**Format:** 100% Done-For-You

***Includes Everything in Tier 3, Plus:***
- Up to 40 email + SMS campaigns per month
- Bi-weekly and quarterly strategy meetings with senior strategists
- On-demand creative requests with defined turnaround times
- Flow creation and optimization as needed
- Cross-channel collaboration with paid media, loyalty, referral, and subscription programs
- Advanced segmentation and predictive analytics
- Quarterly CX audits across the full retention funnel
- Dedicated communication channel and priority support

***Why Upgrade***
Gain a dedicated performance partner embedded into your growth strategy every week',
  updated_at = now()
WHERE slug = 'ongoing_account_management_tier_4';

-- Back-fill existing audit add-on items from templates (preserve display_order, is_hidden, image_url, details_url).
UPDATE public.audits a
SET layout = jsonb_set(
  a.layout,
  '{revenue_summary,blocks,addOns,items}',
  (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN t.slug IS NOT NULL THEN
          item || jsonb_build_object(
            'name', t.name,
            'description', t.description,
            'content', t.content,
            'bullets', '[]'::jsonb,
            'one_time_price', t.one_time_price,
            'one_time_label', t.one_time_label,
            'monthly_price', t.monthly_price,
            'monthly_label', t.monthly_label
          )
        ELSE item
      END
      ORDER BY ord
    ), '[]'::jsonb)
    FROM jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items')
      WITH ORDINALITY AS x(item, ord)
    LEFT JOIN public.revenue_opportunity_templates t
      ON t.slug = item->>'template_slug'
  ),
  true
)
WHERE a.layout->'revenue_summary'->'blocks'->'addOns'->'items' IS NOT NULL
  AND jsonb_array_length(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') > 0;
