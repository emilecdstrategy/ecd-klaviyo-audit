// Supabase Edge Function: ai_analyze_audit
// - No secrets in repo. Configure OPENAI_API_KEY (or ANTHROPIC_API_KEY) via Supabase secrets.
// - This function currently returns a deterministic structure so the app can integrate end-to-end.
// - Replace `generate()` with a real LLM call when ready.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type WizardData = {
  industry: string;
  listSize: number;
  aov: number;
};

type AIAnalysisResult = {
  executiveSummary: string;
  sections: Array<{
    section_key: string;
    current_state_title?: string;
    optimized_state_title?: string;
    current_state_notes?: string;
    optimized_notes?: string;
    ai_findings?: string;
    summary_text?: string;
    revenue_opportunity?: number;
    confidence?: "low" | "medium" | "high";
  }>;
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function generate(input: WizardData): AIAnalysisResult {
  const { industry, listSize, aov } = input;
  const est = Math.round((listSize || 0) * (aov || 0) * 0.02);
  return {
    executiveSummary:
      `Based on our analysis of your ${industry || "industry"} email program, we've identified high-impact opportunities across flows, segmentation, and signup forms. ` +
      `Implementing the recommended changes could unlock an estimated $${est.toLocaleString()}/month in additional revenue.`,
    sections: [
      { section_key: "account_health", ai_findings: "Baseline performance and deliverability risks identified.", confidence: "medium" },
      { section_key: "flows", ai_findings: "Missing or under-optimized core flows detected.", confidence: "high" },
      { section_key: "segmentation", ai_findings: "Segmentation depth can be improved with engagement and RFM tiers.", confidence: "medium" },
      { section_key: "campaigns", ai_findings: "Cadence and testing framework opportunities found.", confidence: "medium" },
      { section_key: "email_design", ai_findings: "Design hierarchy and mobile-first improvements recommended.", confidence: "medium" },
      { section_key: "signup_forms", ai_findings: "Popup timing and multi-step capture improvements recommended.", confidence: "high" },
    ],
  };
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  try {
    const body = (await req.json()) as WizardData;
    return json(generate(body));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 400 });
  }
});

