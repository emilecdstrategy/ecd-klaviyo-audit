export const AI_SCHEMA_VERSION = "2026-03-26.v2";

export const AUDIT_SECTION_KEYS = [
  "account_health",
  "flows",
  "segmentation",
  "campaigns",
  "email_design",
  "signup_forms",
] as const;

export type Confidence = "low" | "medium" | "high";
export type SectionKey = typeof AUDIT_SECTION_KEYS[number];

export type AISection = {
  section_key: SectionKey;
  current_state_title: string;
  optimized_state_title: string;
  current_state_notes: string;
  optimized_notes: string;
  ai_findings: string;
  summary_text: string;
  revenue_opportunity: number;
  confidence: Confidence;
};

export type AIOutput = {
  schemaVersion: string;
  executiveSummary: string;
  strengths: string[];
  concerns: string[];
  sections: AISection[];
};

export const AI_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "executiveSummary", "strengths", "concerns", "sections"],
  properties: {
    schemaVersion: { type: "string" },
    executiveSummary: { type: "string", minLength: 80, maxLength: 4000 },
    strengths: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: { type: "string", minLength: 20, maxLength: 300 },
    },
    concerns: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: { type: "string", minLength: 20, maxLength: 300 },
    },
    sections: {
      type: "array",
      minItems: 1,
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
          section_key: { type: "string", enum: AUDIT_SECTION_KEYS },
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

type ValidationResult = { ok: true; value: AIOutput } | { ok: false; errors: string[] };

export function validateOutput(input: unknown, requiredSectionKeys: readonly SectionKey[] = AUDIT_SECTION_KEYS): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, errors: ["Output is not an object"] };
  const out = input as Partial<AIOutput>;
  const errors: string[] = [];

  if (out.schemaVersion !== AI_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${AI_SCHEMA_VERSION}`);
  }
  if (!out.executiveSummary || out.executiveSummary.trim().length < 80) {
    errors.push("executiveSummary is too short");
  }
  if (!Array.isArray(out.strengths) || out.strengths.length < 3) {
    errors.push("strengths must have at least 3 items");
  }
  if (!Array.isArray(out.concerns) || out.concerns.length < 3) {
    errors.push("concerns must have at least 3 items");
  }
  if (!Array.isArray(out.sections) || out.sections.length === 0) {
    errors.push("sections must be a non-empty array");
  }

  const byKey = new Map<string, AISection>();
  const placeholderRegex = /(lorem ipsum|placeholder|tbd|insert here|example text)/i;
  for (const key of requiredSectionKeys) {
    const section = (out.sections ?? []).find((s) => (s as AISection).section_key === key) as AISection | undefined;
    if (!section) {
      errors.push(`missing section ${key}`);
      continue;
    }
    byKey.set(key, section);
    if (!section.summary_text || section.summary_text.trim().length < 40) errors.push(`${key}: summary_text too short`);
    if (!section.ai_findings || section.ai_findings.trim().length < 40) errors.push(`${key}: ai_findings too short`);
    if (section.revenue_opportunity == null || Number.isNaN(section.revenue_opportunity) || section.revenue_opportunity < 0) {
      errors.push(`${key}: revenue_opportunity invalid`);
    }
    if (!["low", "medium", "high"].includes(section.confidence)) errors.push(`${key}: confidence invalid`);
    if (placeholderRegex.test(section.summary_text) || placeholderRegex.test(section.ai_findings)) {
      errors.push(`${key}: contains placeholder language`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: AI_SCHEMA_VERSION,
      executiveSummary: out.executiveSummary!.trim(),
      strengths: (out.strengths ?? []).map((s: string) => s.trim()),
      concerns: (out.concerns ?? []).map((s: string) => s.trim()),
      sections: requiredSectionKeys.map((k) => byKey.get(k)!),
    },
  };
}

export function failedSectionKeysFromErrors(errors: string[]): SectionKey[] {
  const keys = new Set<SectionKey>();
  for (const e of errors) {
    for (const key of AUDIT_SECTION_KEYS) {
      if (e.startsWith(`${key}:`) || e.includes(`section ${key}`)) keys.add(key);
    }
  }
  return [...keys];
}
