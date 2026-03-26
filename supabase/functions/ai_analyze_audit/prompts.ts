import { AI_SCHEMA_VERSION } from "./schema.ts";

type WizardData = {
  clientId?: string;
  clientName?: string;
  companyName?: string;
  industry?: string;
  espPlatform?: string;
  websiteUrl?: string;
  listSize?: number;
  aov?: number;
  monthlyTraffic?: number;
  notes?: string;
  auditMethod?: "api" | "screenshot";
};

export function buildAuditSystemPrompt() {
  return [
    "You are a principal Klaviyo lifecycle strategist and conversion auditor.",
    "Return only valid JSON matching the provided schema.",
    `Set schemaVersion to '${AI_SCHEMA_VERSION}'.`,
    "Use crisp, client-facing writing with concrete findings and realistic revenue opportunities.",
    "Do not use placeholders, hedging, or vague generic statements.",
  ].join(" ");
}

export function buildAuditUserPrompt(data: WizardData) {
  return JSON.stringify(
    {
      task: "Generate a full audit analysis.",
      input: data,
      required_sections: [
        "account_health",
        "flows",
        "segmentation",
        "campaigns",
        "email_design",
        "signup_forms",
      ],
      style: {
        audience: "ecommerce founder/marketing lead",
        tone: "executive, practical",
        include_benchmarks: true,
      },
      constraints: {
        currency: "USD",
        no_negative_revenue_opportunity: true,
      },
    },
    null,
    2,
  );
}

export function buildRepairUserPrompt(params: {
  failedSectionKeys: string[];
  originalInput: WizardData;
  previousOutput: unknown;
}) {
  return JSON.stringify(
    {
      task: "Regenerate only failed sections and keep schema compliance.",
      failed_sections: params.failedSectionKeys,
      original_input: params.originalInput,
      previous_output: params.previousOutput,
      instructions: [
        "Return a full valid object with all required sections.",
        "Prioritize section clarity, concrete opportunities, and valid numeric fields.",
      ],
    },
    null,
    2,
  );
}

