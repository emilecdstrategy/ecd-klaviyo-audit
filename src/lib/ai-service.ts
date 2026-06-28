import type { AuditContext, AuditSection, WizardData } from './types';
import { supabase } from './supabase';
import { repairSplitFindings } from './findings-normalize';
import { AI_SCHEMA_VERSION, AUDIT_SECTION_KEYS } from './ai/schema';

// Future: Replace with real OpenAI API calls through a Supabase Edge Function
// The edge function would accept section data and return AI-generated findings

interface AIAnalysisResult {
  sections: Partial<AuditSection>[];
  executiveSummary: string;
  findings?: string[];
  strengths?: string[];
  implementationTimeline?: { phase: string; timeframe: string; label: string; items: string[] }[];
}

type AIRequestMode = 'full' | 'sections_only' | 'top_level_only' | 'refine';

function auditContextHasContent(c?: AuditContext | null): boolean {
  if (!c) return false;
  return Boolean(
    (c.meeting_notes?.trim() ?? '') ||
      (c.client_background?.trim() ?? '') ||
      (c.custom_instructions?.trim() ?? ''),
  );
}
type ProgressUpdate = { current: number; total: number; label: string };

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

function hasTopLevelPayload(data: any): boolean {
  return Boolean(
    data &&
    data.schemaVersion === AI_SCHEMA_VERSION &&
    typeof data.executiveSummary === 'string' &&
    Array.isArray(data.findings) &&
    data.findings.length === 5 &&
    Array.isArray(data.strengths) &&
    Array.isArray(data.implementationTimeline),
  );
}

function hasSectionsPayload(data: any): boolean {
  return Boolean(
    data &&
    data.schemaVersion === AI_SCHEMA_VERSION &&
    Array.isArray(data.sections) &&
    data.sections.length > 0,
  );
}

export async function runAIAnalysis(
  wizardData: WizardData,
  onProgress?: (update: ProgressUpdate) => void,
): Promise<AIAnalysisResult> {
  // Production path: Edge function only.
  // Demo fallback is only allowed when explicitly enabled.
  const allowFallback = import.meta.env.DEV && import.meta.env.VITE_ALLOW_AI_FALLBACK === 'true';

  try {
    const call = async (
      requestedSectionKeys: string[],
      aiMode: AIRequestMode,
      label: string,
      extra?: { refineBaseline?: unknown; auditContext?: unknown },
    ) => {
      const body =
        aiMode === 'refine'
          ? {
              ...wizardData,
              aiMode: 'refine',
              refineBaseline: extra?.refineBaseline,
              auditContext: extra?.auditContext ?? wizardData.auditContext,
            }
          : { ...wizardData, requestedSectionKeys, aiMode };
      const { data, error } = await supabase.functions.invoke<any>('ai_analyze_audit', {
        body,
      });
      if (error) {
        const anyErr = error as any;
        const status = anyErr?.context?.status ?? anyErr?.status ?? null;
        const body = anyErr?.context?.body ?? anyErr?.body ?? null;
        const bodyPreview =
          body && typeof body === 'object' && (body as any).getReader
            ? '[ReadableStream]'
            : body
              ? String(body).slice(0, 240)
              : null;
        const details = [
          status ? `status ${status}` : null,
          bodyPreview ? `body ${bodyPreview}` : null,
          import.meta.env.VITE_SUPABASE_URL ? `supabase ${String(import.meta.env.VITE_SUPABASE_URL)}` : null,
        ].filter(Boolean).join(' • ');
        throw new AIAnalysisError(
          `ai_analyze_audit failed (${label}): ${error.message || 'AI request failed'}${details ? ` (${details})` : ''}`,
          'provider_error',
        );
      }
      if (data?.ok === false) {
        const code = (data?.error?.code ?? 'provider_error') as AIErrorCode;
        const msg = data?.error?.message ?? 'AI request failed';
        throw new AIAnalysisError(msg, code, data?.correlationId);
      }
      if (aiMode === 'refine') {
        if (!hasTopLevelPayload(data) || !hasSectionsPayload(data)) {
          throw new AIAnalysisError(`Invalid AI refine response shape (${label})`, 'bad_response', data?.correlationId);
        }
      } else if (aiMode === 'top_level_only') {
        if (!hasTopLevelPayload(data)) throw new AIAnalysisError(`Invalid AI top-level response shape (${label})`, 'bad_response', data?.correlationId);
      } else if (!hasSectionsPayload(data)) {
        throw new AIAnalysisError(`Invalid AI sections response shape (${label})`, 'bad_response', data?.correlationId);
      }
      return data as AIAnalysisResult;
    };

    /** Retry on provider timeouts AND transport errors (e.g. 504 from Supabase gateway). */
    const withRetryOnTimeout = async (fn: () => Promise<AIAnalysisResult>, label: string) => {
      const maxAttempts = 3;
      let last: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (e) {
          last = e;
          const isRetryable = e instanceof AIAnalysisError
            ? (e.code === 'provider_timeout' || e.code === 'provider_error')
            : (e instanceof Error && /timeout|504|546|502|503|Failed to send/i.test(e.message));
          if (isRetryable && attempt < maxAttempts) {
            const base = 1500 + Math.floor(Math.random() * 1000) + attempt * 1000;
            await new Promise(r => setTimeout(r, base));
            onProgress?.({ current: 0, total: 0, label: `Retrying ${label} (attempt ${attempt + 1})…` });
            continue;
          }
          throw e;
        }
      }
      throw last instanceof Error ? last : new Error('AI analysis failed after retries');
    };

    // Keep section requests small to reduce provider timeout risk on larger accounts.
    const sectionBatches: { keys: string[]; label: string }[] = [
      { keys: ['account_health'], label: 'section 1/6' },
      { keys: ['flows'], label: 'section 2/6' },
      { keys: ['segmentation'], label: 'section 3/6' },
      { keys: ['campaigns'], label: 'section 4/6' },
      { keys: ['email_design'], label: 'section 5/6' },
      { keys: ['signup_forms'], label: 'section 6/6' },
    ];

    const hasRefine = auditContextHasContent(wizardData.auditContext);
    const totalSteps = 1 + sectionBatches.length + (hasRefine ? 1 : 0);
    onProgress?.({ current: 1, total: totalSteps, label: `Generating executive summary (1/${totalSteps})…` });
    const top = await withRetryOnTimeout(
      () => call([], 'top_level_only', 'top-level summary'),
      'top-level summary',
    );

    const sections: Partial<AuditSection>[] = [];
    for (let i = 0; i < sectionBatches.length; i++) {
      const batch = sectionBatches[i];
      onProgress?.({ current: i + 2, total: totalSteps, label: `Analyzing ${batch.label} (${i + 2}/${totalSteps})…` });
      const result = await withRetryOnTimeout(
        () => call(batch.keys, 'sections_only', batch.label),
        batch.label,
      );
      sections.push(...(result.sections ?? []));
    }

    if (!sections.length) throw new AIAnalysisError('AI returned no sections', 'bad_response');
    const order = new Map<string, number>(AUDIT_SECTION_KEYS.map((k, i) => [k, i]));
    sections.sort((a, b) =>
      (order.get(String((a as any).section_key)) ?? 999) - (order.get(String((b as any).section_key)) ?? 999),
    );

    let executiveSummary = top.executiveSummary;
    let findingsOut = repairSplitFindings(top.findings ?? []);
    let strengthsOut = top.strengths ?? [];
    let timelineOut = top.implementationTimeline ?? [];
    let sectionOut: Partial<AuditSection>[] = sections;

    if (hasRefine) {
      const refineBaseline = {
        companyName: wizardData.companyName,
        clientName: wizardData.clientName,
        executiveSummary,
        findings: findingsOut,
        strengths: strengthsOut,
        implementationTimeline: timelineOut,
        sections: sectionOut.map((s) => ({ ...s })),
      };
      onProgress?.({
        current: totalSteps,
        total: totalSteps,
        label: `Refining with client context (${totalSteps}/${totalSteps})…`,
      });
      try {
        const refined = await withRetryOnTimeout(
          () =>
            call([], 'refine', 'client context refinement', {
              refineBaseline,
              auditContext: wizardData.auditContext,
            }),
          'client context refinement',
        );
        executiveSummary = refined.executiveSummary;
        findingsOut = repairSplitFindings(refined.findings ?? findingsOut);
        strengthsOut = refined.strengths ?? strengthsOut;
        timelineOut = refined.implementationTimeline ?? timelineOut;
        sectionOut = (refined.sections ?? sectionOut) as Partial<AuditSection>[];
      } catch {
        onProgress?.({
          current: totalSteps,
          total: totalSteps,
          label: 'Keeping baseline audit (context refinement failed or timed out)',
        });
      }
    }

    return {
      executiveSummary,
      findings: findingsOut,
      strengths: strengthsOut,
      implementationTimeline: timelineOut,
      sections: sectionOut,
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

  const { industry, listSize } = wizardData;

  return {
    executiveSummary: `Based on our analysis of your ${industry} Klaviyo account with ${listSize.toLocaleString()} subscribers, we've identified several high-impact gaps in automated flow coverage, segmentation depth, and signup form optimization that are limiting email performance.`,
    findings: [
      '**Missing browse abandonment flow**, so shoppers who view products but do not purchase are not being recovered automatically',
      '**No post-purchase sequence**, which means repeat purchase and cross-sell opportunities are not being captured after the first order',
      '**Minimal segmentation in use**, with campaigns going to broad lists instead of engaged or high-value audiences',
      '**Inconsistent campaign cadence**, with long gaps between sends and limited content variety beyond promotions',
      '**Basic signup forms only**, with no exit-intent trigger or multi-step flow to capture more subscribers on site',
    ],
    strengths: [
      '**Abandoned cart flow is live**, providing a foundation for automated revenue recovery',
      '**Active campaign program**, showing the team is already investing in email as a channel',
      '**List size supports segmentation**, with enough subscribers to build meaningful audience tiers',
    ],
    implementationTimeline: [
      { phase: 'Quick Wins', timeframe: 'Week 1-2', label: 'Activate low-effort fixes', items: ['Review draft flows for quick activation', 'Audit signup form placement'] },
      { phase: 'Core Flows', timeframe: 'Week 3-6', label: 'Build revenue flows', items: ['Launch browse abandonment', 'Build post-purchase sequence'] },
      { phase: 'Strategic', timeframe: 'Month 2-3', label: 'Segmentation and testing', items: ['Create engagement tiers', 'Establish campaign testing cadence'] },
      { phase: 'Long-Term', timeframe: 'Month 3+', label: 'Advanced personalization', items: ['RFM-based targeting', 'Dynamic content blocks'] },
    ],
    sections: [
      {
        section_key: 'account_health',
        current_state_title: 'Baseline Account Performance',
        optimized_state_title: 'Optimized Account Benchmark',
        current_state_notes: `Account is generating revenue primarily through campaign sends. Automated flows account for less than 15% of total email revenue. List hygiene practices need improvement with a significant portion of inactive subscribers.`,
        optimized_notes: `Industry-leading ${industry} brands typically generate 30-45% of email revenue through automated flows. Regular list cleaning maintains deliverability above 98% and engagement rates 2-3x above current levels.`,
        ai_findings: `Key gaps identified: Low flow-to-campaign revenue ratio, inactive subscriber management needed, deliverability risks from list quality issues.`,
        key_findings: {
          items: [
            `Your account has strong foundational elements but is underperforming relative to ${industry} benchmarks.`,
            'Revenue is weighted toward manual campaigns instead of automated, behavior-triggered flows.',
            'List hygiene and engagement tiers need attention to unlock the next performance tier.',
          ],
        },
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
        key_findings: {
          items: [
            '**Missing core flows**, including browse abandonment and post-purchase sequences.',
            'Existing abandoned cart flow uses a single email with no conditional splits or personalization.',
            'Adding and optimizing core flows represents the largest revenue opportunity in this audit.',
          ],
        },
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
        key_findings: {
          items: [
            '**Batch-and-blast sending** dominates with minimal engagement-based segmentation.',
            'No VIP, RFM, or lifecycle segments are in active use for campaign targeting.',
            'Segmented sends typically lift opens 15–25% and clicks 30–50% versus full-list blasts.',
          ],
        },
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
        key_findings: {
          items: [
            '**Inconsistent send cadence** with long gaps between promotional campaigns.',
            'Campaign mix is heavily discount-driven with limited educational or engagement content.',
            'No systematic A/B testing on subject lines, send times, or creative formats.',
          ],
        },
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
        key_findings: {
          items: [
            '**Mobile rendering issues** and weak visual hierarchy limit click-through on campaigns.',
            'CTAs are not consistently placed above the fold across templates.',
            'Brand and layout consistency varies widely between campaign sends.',
          ],
        },
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
        key_findings: {
          items: [
            '**Popup form conversion** is below industry benchmarks for this vertical.',
            'No exit-intent, multi-step, or scroll-depth triggers are configured.',
            'Embedded capture forms are minimal across key site pages.',
          ],
        },
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
