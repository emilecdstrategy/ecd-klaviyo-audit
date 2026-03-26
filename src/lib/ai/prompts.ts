import type { WizardData } from "../types";
import { AI_SCHEMA_VERSION } from "./schema";

export function buildAuditSystemPrompt() {
  return [
    "You are a senior lifecycle marketing strategist specializing in Klaviyo audits for DTC and B2B brands.",
    "Write concise, specific, client-facing analysis with quantified opportunity estimates.",
    "Always return JSON only and strictly follow the provided JSON schema.",
    `Set schemaVersion to "${AI_SCHEMA_VERSION}".`,
    "Avoid placeholders, avoid generic advice, and avoid unsupported claims.",
  ].join(" ");
}

export function buildAuditUserPrompt(data: WizardData) {
  return JSON.stringify(
    {
      task: "Generate a full audit analysis for all required sections.",
      input: data,
      writing_style: {
        tone: "executive, practical, clear",
        include_benchmarks: true,
        avoid_filler: true,
      },
      constraints: {
        currency: "USD",
        monthly_revenue_opportunity_non_negative: true,
      },
    },
    null,
    2,
  );
}

export function buildSectionRepairPrompt(params: {
  failedSectionKeys: string[];
  originalData: WizardData;
  previousOutput: unknown;
}) {
  return JSON.stringify(
    {
      task: "Repair only failed sections while preserving valid sections and executive summary quality.",
      failed_sections: params.failedSectionKeys,
      input: params.originalData,
      previous_output: params.previousOutput,
      instructions: [
        "Regenerate complete objects for failed sections.",
        "Do not return any section outside the failed_sections list.",
        "Keep factual consistency with provided inputs.",
      ],
    },
    null,
    2,
  );
}

