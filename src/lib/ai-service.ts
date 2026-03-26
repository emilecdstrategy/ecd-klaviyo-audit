import type { AuditSection, WizardData } from './types';
import { supabase } from './supabase';
import { AI_SCHEMA_VERSION } from './ai/schema';

// Future: Replace with real OpenAI API calls through a Supabase Edge Function
// The edge function would accept section data and return AI-generated findings

interface AIAnalysisResult {
  sections: Partial<AuditSection>[];
  executiveSummary: string;
  strengths?: string[];
  concerns?: string[];
}

type AIErrorCode =
  | 'retry'
  | 'provider_timeout'
  | 'validation_failed'
  | 'provider_error'
  | 'bad_response';

export class AIAnalysisError extends Error {
  code: AIErrorCode;
  correlationId?: string;

  constructor(message: string, code: AIErrorCode, correlationId?: string) {
    super(message);
    this.name = 'AIAnalysisError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

function validateClientPayload(data: any): data is AIAnalysisResult {
  return Boolean(
    data &&
    data.schemaVersion === AI_SCHEMA_VERSION &&
    typeof data.executiveSummary === 'string' &&
    Array.isArray(data.sections) &&
    data.sections.length > 0,
  );
}

export async function runAIAnalysis(wizardData: WizardData): Promise<AIAnalysisResult> {
  // Production path: Edge function only.
  // Demo fallback is only allowed when explicitly enabled.
  const allowFallback = import.meta.env.DEV && import.meta.env.VITE_ALLOW_AI_FALLBACK === 'true';

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new AIAnalysisError('Your session expired. Please sign in again and retry.', 'provider_error');

    const call = async (requestedSectionKeys: string[]) => {
      const { data, error } = await supabase.functions.invoke<any>('ai_analyze_audit', {
        body: { ...wizardData, requestedSectionKeys },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw new AIAnalysisError(error.message || 'AI request failed', 'provider_error');
      if (data?.ok === false) {
        const code = (data?.error?.code ?? 'provider_error') as AIErrorCode;
        const msg = data?.error?.message ?? 'AI request failed';
        throw new AIAnalysisError(msg, code, data?.correlationId);
      }
      if (!validateClientPayload(data)) throw new AIAnalysisError('Invalid AI response shape', 'bad_response', data?.correlationId);
      return data as AIAnalysisResult;
    };

    // Split into two smaller requests to avoid provider timeouts.
    const withRetryOnTimeout = async (fn: () => Promise<AIAnalysisResult>) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof AIAnalysisError && e.code === 'provider_timeout') {
          // One quick retry: timeouts are frequently transient.
          return await fn();
        }
        throw e;
      }
    };

    const first = await withRetryOnTimeout(() => call(['account_health', 'flows', 'segmentation']));
    const second = await withRetryOnTimeout(() => call(['campaigns', 'email_design', 'signup_forms']));

    const sections = [...(first.sections ?? []), ...(second.sections ?? [])];
    if (!sections.length) throw new AIAnalysisError('AI returned no sections', 'bad_response');

    return {
      executiveSummary: first.executiveSummary,
      strengths: first.strengths ?? [],
      concerns: first.concerns ?? [],
      sections,
    };
  } catch (e) {
    if (!allowFallback) {
      if (e instanceof AIAnalysisError) throw e;
      throw new AIAnalysisError(
        e instanceof Error ? e.message : 'Unknown AI error',
        'provider_error',
      );
    }
  }

  // Explicitly gated development fallback only.
  await new Promise(r => setTimeout(r, 3000));

  const { industry, listSize, aov } = wizardData;

  return {
    executiveSummary: `Based on our analysis of your ${industry} Klaviyo account with ${listSize.toLocaleString()} subscribers, we've identified several high-impact opportunities to improve email revenue performance. Your current setup has meaningful gaps in automated flow coverage, segmentation depth, and signup form optimization. Implementing our recommended changes could unlock an estimated $${Math.round(listSize * aov * 0.02).toLocaleString()}/month in additional revenue.`,
    sections: [
      {
        section_key: 'account_health',
        current_state_title: 'Baseline Account Performance',
        optimized_state_title: 'Optimized Account Benchmark',
        current_state_notes: `Account is generating revenue primarily through campaign sends. Automated flows account for less than 15% of total email revenue. List hygiene practices need improvement with a significant portion of inactive subscribers.`,
        optimized_notes: `Industry-leading ${industry} brands typically generate 30-45% of email revenue through automated flows. Regular list cleaning maintains deliverability above 98% and engagement rates 2-3x above current levels.`,
        ai_findings: `Key gaps identified: Low flow-to-campaign revenue ratio, inactive subscriber management needed, deliverability risks from list quality issues.`,
        summary_text: `Your account has strong foundational elements but is underperforming relative to ${industry} benchmarks. The primary opportunity is shifting revenue from manual campaigns to automated, behavior-triggered flows.`,
        revenue_opportunity: Math.round(listSize * 0.15),
        confidence: 'high' as const,
      },
      {
        section_key: 'flows',
        current_state_title: 'Current Flow Architecture',
        optimized_state_title: 'Recommended Flow Strategy',
        current_state_notes: `Limited automation in place. Missing critical flows including browse abandonment and post-purchase sequences. Existing abandoned cart flow uses a single email with generic messaging and no conditional splits.`,
        optimized_notes: `Best-in-class ${industry} brands run 7+ automated flows with multi-step sequences, A/B tested subject lines, dynamic product recommendations, and conditional splits based on customer value and behavior.`,
        ai_findings: `Missing flows: Browse Abandonment, Post-Purchase, Winback, Back-in-Stock. Existing flows lack personalization, conditional logic, and proper timing optimization.`,
        summary_text: `Your flow architecture has significant room for improvement. Adding the missing core flows and optimizing existing ones represents the single largest revenue opportunity in this audit.`,
        revenue_opportunity: Math.round(listSize * 0.35),
        confidence: 'high' as const,
      },
      {
        section_key: 'segmentation',
        current_state_title: 'Current Segmentation Approach',
        optimized_state_title: 'Advanced Segmentation Strategy',
        current_state_notes: `Minimal segmentation in use. Campaigns are sent to full list or basic segments (e.g., all subscribers, recent purchasers). No RFM-based segments or engagement tiers.`,
        optimized_notes: `Implement engagement-based tiers (active, at-risk, dormant), RFM scoring, purchase behavior segments, and browse behavior segments. Personalize campaign content and send frequency by segment.`,
        ai_findings: `No engagement-based segmentation detected. Missing VIP/loyalty segments, product interest segments, and lifecycle stage segments.`,
        summary_text: `Moving from batch-and-blast to segmented campaigns typically increases open rates by 15-25% and click rates by 30-50%, directly impacting revenue per send.`,
        revenue_opportunity: Math.round(listSize * 0.08),
        confidence: 'medium' as const,
      },
      {
        section_key: 'campaigns',
        current_state_title: 'Current Campaign Cadence',
        optimized_state_title: 'Optimized Campaign Strategy',
        current_state_notes: `Inconsistent send cadence with gaps of 7+ days between campaigns. Content is primarily promotional with limited value-add or educational content. No A/B testing program in place.`,
        optimized_notes: `Establish a consistent 3-4x/week send cadence mixing promotional (60%), educational (25%), and engagement (15%) content. Implement systematic A/B testing on subject lines, send times, and content formats.`,
        ai_findings: `Irregular send schedule, over-reliance on discount-driven campaigns, no testing framework, and limited content variety.`,
        summary_text: `A structured campaign calendar with content variety and consistent testing will improve subscriber engagement and reduce unsubscribe rates while maintaining or improving revenue per send.`,
        revenue_opportunity: Math.round(listSize * 0.06),
        confidence: 'medium' as const,
      },
      {
        section_key: 'email_design',
        current_state_title: 'Current Email Design',
        optimized_state_title: 'Design Best Practices',
        current_state_notes: `Email templates are text-heavy with limited visual hierarchy. CTAs are not prominently placed. Mobile rendering has layout issues. Brand consistency varies across campaigns.`,
        optimized_notes: `Modern email design for ${industry} should feature clean layouts, strong visual hierarchy, mobile-first design, prominent CTAs above the fold, and consistent brand elements. Use dynamic content blocks for personalization.`,
        ai_findings: `Design improvements needed: Mobile optimization, CTA placement and styling, visual hierarchy, image-to-text ratio, and brand consistency.`,
        summary_text: `Upgrading email design to current best practices typically improves click-through rates by 20-40%, which directly translates to higher conversion rates and revenue per email.`,
        revenue_opportunity: Math.round(listSize * 0.04),
        confidence: 'medium' as const,
      },
      {
        section_key: 'signup_forms',
        current_state_title: 'Current Form Setup',
        optimized_state_title: 'Optimized Form Strategy',
        current_state_notes: `Basic popup form with a simple discount offer. No exit-intent trigger. No multi-step forms. Limited targeting rules. Embedded forms on site are minimal or absent.`,
        optimized_notes: `Deploy multi-step popup with exit-intent trigger, timed delay, and scroll-depth triggers. Add embedded forms in key page locations. Use gamified elements (spin-to-win) for higher conversion. Target 4-6% conversion rate.`,
        ai_findings: `Form conversion rate is below industry average. Missing exit-intent popup, multi-step form flow, and strategic form placement across the site.`,
        summary_text: `Optimizing signup forms is one of the fastest ways to grow your email list and increase downstream revenue. Current forms are leaving significant subscriber growth on the table.`,
        revenue_opportunity: Math.round(listSize * 0.05),
        confidence: 'high' as const,
      },
    ],
  };
}

export function generateSectionAnalysis(_sectionKey: string, _data: Record<string, unknown>): Promise<string> {
  // Future: Call OpenAI through edge function for specific section analysis
  return Promise.resolve('AI analysis would be generated here via OpenAI integration.');
}
