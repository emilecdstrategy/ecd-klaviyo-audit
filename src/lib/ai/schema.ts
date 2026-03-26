export const AI_SCHEMA_VERSION = "2026-03-26.v3";

export const AUDIT_SECTION_KEYS = [
  "account_health",
  "flows",
  "segmentation",
  "campaigns",
  "email_design",
  "signup_forms",
] as const;

export type AuditSectionKey = typeof AUDIT_SECTION_KEYS[number];

export const AI_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "executiveSummary", "sections"],
  properties: {
    schemaVersion: { type: "string" },
    executiveSummary: { type: "string", minLength: 80, maxLength: 4000 },
    sections: {
      type: "array",
      minItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "section_key",
          "current_state_title",
          "optimized_state_title",
          "current_state_notes",
          "optimized_notes",
          "ai_findings",
          "summary_text",
          "revenue_opportunity",
          "confidence",
        ],
        properties: {
          section_key: {
            type: "string",
            enum: AUDIT_SECTION_KEYS,
          },
          current_state_title: { type: "string", minLength: 3, maxLength: 200 },
          optimized_state_title: { type: "string", minLength: 3, maxLength: 200 },
          current_state_notes: { type: "string", minLength: 40, maxLength: 3000 },
          optimized_notes: { type: "string", minLength: 40, maxLength: 3000 },
          ai_findings: { type: "string", minLength: 40, maxLength: 3000 },
          summary_text: { type: "string", minLength: 40, maxLength: 1200 },
          revenue_opportunity: { type: "number", minimum: 0, maximum: 10000000 },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
  },
} as const;

