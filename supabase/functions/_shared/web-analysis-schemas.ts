import type { LlmTool } from "./llm-adapter.ts";

/** Strip em/en dashes from generated copy (ECD house style). */
export function sanitizeDash(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ")
    .trim();
}

function strArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeDash).filter(Boolean).slice(0, max);
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

// --- Tool schemas (forced via tool_choice) ---------------------------------

export const PAGE_AUDIT_TOOL: LlmTool = {
  name: "record_page_audit",
  description: "Record the audit of this page: a short intro, strengths (pros), issues (findings, each optionally pinpointing a region of a referenced screenshot), and prioritized recommendations.",
  input_schema: {
    type: "object",
    required: ["intro", "findings", "recommendations"],
    properties: {
      intro: { type: "string", description: "2-3 sentence summary of this page's state" },
      pros: { type: "array", items: { type: "string" }, description: "What already works well on this page" },
      findings: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", description: "The problem in ONE short sentence, max ~16 words. State the issue, no preamble." },
            recommendation: { type: "string", description: "The fix in 1-2 sentences: the concrete, Shopify-feasible change (element, copy, placement) plus why it lifts conversion/AOV/trust. Start with a verb. Grounded in standard e-commerce CRO best practices, no vague advice." },
            viewport: { type: "string", enum: ["desktop", "mobile", "both"], description: "Which viewport this issue is about. Use 'desktop' or 'mobile' when it is specific to one (judge from the IMG_n you are looking at), or 'both' when it applies equally to both. Prefer a specific viewport over 'both' when the issue is more visible or more severe on one." },
            highlight: {
              type: "object",
              description:
                "Optional: pinpoint the exact element this finding is about so a reader can see what you mean. STRONGLY PREFERRED: when the message lists real page elements for the referenced image (each with an id like el_12), set element_id to the one that matches, its real on-page box is used automatically (this is the accurate path, use it whenever an element fits). Only if NO listed element matches, fall back to x/y/w/h as a tight box in percentages of the image (0,0 = top-left, 100,100 = bottom-right). Omit the highlight entirely if you cannot confidently locate it; a missing pin beats a wrong one.",
              required: ["image_ref", "label"],
              properties: {
                image_ref: { type: "string", description: "The IMG_n label of the screenshot this refers to" },
                element_id: { type: "string", description: "PREFERRED: the id (e.g. el_12) of the matching element from the listed page elements for this image" },
                x: { type: "number", description: "Fallback only: left edge of a tight box, % of image width (0-100)" },
                y: { type: "number", description: "Fallback only: top edge of a tight box, % of image height (0-100)" },
                w: { type: "number", description: "Fallback only: box width, % of image width" },
                h: { type: "number", description: "Fallback only: box height, % of image height" },
                label: { type: "string", description: "Short label naming the element, max 6 words" },
              },
            },
          },
        },
      },
      recommendations: { type: "array", maxItems: 6, description: "Prioritized, CRO-focused action items for this page (highest conversion impact first). Each is concrete and Shopify-feasible, naming the change and its conversion rationale. No vague or generic advice.", items: { type: "string" } },
    },
  },
};

export const ANALYTICS_TOOL: LlmTool = {
  name: "record_analytics_audit",
  description: "Record commentary and recommendations for the store's performance metrics. Do not restate the raw numbers; interpret the trend and say what to do about it.",
  input_schema: {
    type: "object",
    required: ["intro", "metrics"],
    properties: {
      intro: { type: "string" },
      metrics: {
        type: "array",
        items: {
          type: "object",
          required: ["key", "commentary"],
          properties: {
            key: { type: "string", enum: ["revenue", "orders", "aov", "returning_customer_rate", "top_products", "sales_by_channel"] },
            commentary: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
    },
  },
};

export const OVERVIEW_TOOL: LlmTool = {
  name: "record_overview",
  description: "Record the audit's opening: a short intro paragraph and an 'Overall Pros' list summarizing the store's strengths across all pages.",
  input_schema: {
    type: "object",
    required: ["intro", "overall_pros"],
    properties: {
      intro: { type: "string" },
      overall_pros: { type: "array", minItems: 3, maxItems: 10, items: { type: "string" } },
    },
  },
};

export const ROADMAP_TOOL: LlmTool = {
  name: "record_roadmap",
  description: "Turn the findings into a prioritized roadmap. Match each item to a catalog service by its slug when one fits; otherwise leave template_slug null. Never state prices; they are filled from the catalog.",
  input_schema: {
    type: "object",
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          required: ["priority", "item_name"],
          properties: {
            priority: { type: "string", enum: ["high", "medium", "low"] },
            item_name: { type: "string" },
            template_slug: { type: ["string", "null"] },
            note: { type: "string" },
          },
        },
      },
    },
  },
};

// --- Coercers (tool input -> persisted shape) ------------------------------

export type WebHighlight = { snapshot_id: string; x: number; y: number; w: number; h: number; label: string };
export type WebViewportTag = "desktop" | "mobile" | "both";
export type WebFinding = { text: string; recommendation: string; viewport: WebViewportTag; highlight?: WebHighlight; hidden: boolean };

export type ElementBox = { id: string; x: number; y: number; w: number; h: number; label?: string };

export function coercePageAudit(
  input: unknown,
  imageRefToSnapshotId: Map<string, string>,
  refToElements?: Map<string, ElementBox[]>,
  refToViewport?: Map<string, string>,
) {
  const o = (input ?? {}) as Record<string, unknown>;
  const findingsRaw = Array.isArray(o.findings) ? o.findings : [];
  const findings: WebFinding[] = findingsRaw.slice(0, 8).map((f) => {
    const rec = (f ?? {}) as Record<string, unknown>;
    const rawViewport = String(rec.viewport ?? "").toLowerCase();
    const hlRef = String((rec.highlight as Record<string, unknown> | undefined)?.image_ref ?? "");
    const viewport: WebViewportTag =
      rawViewport === "desktop" || rawViewport === "mobile"
        ? rawViewport
        : rawViewport === "both"
        ? "both"
        : hlRef && refToViewport?.get(hlRef) === "desktop"
        ? "desktop"
        : hlRef && refToViewport?.get(hlRef) === "mobile"
        ? "mobile"
        : "both";
    const finding: WebFinding = {
      text: sanitizeDash(rec.text),
      recommendation: sanitizeDash(rec.recommendation),
      viewport,
      hidden: false,
    };
    const hl = rec.highlight as Record<string, unknown> | undefined;
    if (hl && typeof hl === "object") {
      const ref = String(hl.image_ref ?? "");
      const snapshotId = imageRefToSnapshotId.get(ref);
      if (snapshotId) {
        // Preferred: a real element box resolved from the captured page. Falls
        // back to the model's own x/y/w/h box when no element id matches.
        const elId = typeof hl.element_id === "string" ? hl.element_id.trim() : "";
        const el = elId ? (refToElements?.get(ref) ?? []).find((e) => e.id === elId) : undefined;
        let box: { x: number; y: number; w: number; h: number; label?: string } | null = null;
        if (el) {
          box = { x: clampPct(el.x), y: clampPct(el.y), w: clampPct(el.w), h: clampPct(el.h), label: el.label };
        } else {
          const w = clampPct(hl.w);
          const h = clampPct(hl.h);
          if (w > 0 && h > 0) box = { x: clampPct(hl.x), y: clampPct(hl.y), w, h };
        }
        if (box && box.w > 0 && box.h > 0) {
          finding.highlight = {
            snapshot_id: snapshotId,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            label: (sanitizeDash(hl.label) || sanitizeDash(box.label)).slice(0, 80),
          };
        }
      }
    }
    return finding;
  }).filter((f) => f.text);
  return {
    intro: sanitizeDash(o.intro),
    pros: strArray(o.pros, 10),
    findings,
    recommendations: strArray(o.recommendations, 6),
  };
}

const METRIC_KEYS = new Set(["revenue", "orders", "aov", "returning_customer_rate", "top_products", "sales_by_channel"]);

export function coerceAnalytics(input: unknown) {
  const o = (input ?? {}) as Record<string, unknown>;
  const metricsRaw = Array.isArray(o.metrics) ? o.metrics : [];
  const metrics = metricsRaw
    .map((m) => {
      const rec = (m ?? {}) as Record<string, unknown>;
      return {
        key: String(rec.key ?? ""),
        commentary: sanitizeDash(rec.commentary),
        recommendation: sanitizeDash(rec.recommendation),
      };
    })
    .filter((m) => METRIC_KEYS.has(m.key) && m.commentary);
  return { intro: sanitizeDash(o.intro), metrics };
}

export function coerceOverview(input: unknown) {
  const o = (input ?? {}) as Record<string, unknown>;
  return { intro: sanitizeDash(o.intro), overall_pros: strArray(o.overall_pros, 10) };
}

// --- Roadmap pricing (resolved server-side from the catalog) ---------------

type CatalogRow = {
  slug: string;
  name: string;
  one_time_price: number | null;
  one_time_label: string | null;
  monthly_price: number | null;
  monthly_label: string | null;
};

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export type RoadmapRow = {
  priority: "high" | "medium" | "low";
  item_name: string;
  template_slug: string | null;
  note: string;
  setup_cost_label: string;
  ongoing_cost_label: string;
  hidden: boolean;
};

export function coerceRoadmap(input: unknown, catalog: CatalogRow[]): RoadmapRow[] {
  const o = (input ?? {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(o.rows) ? o.rows : [];
  const bySlug = new Map(catalog.map((c) => [c.slug, c]));
  return rowsRaw.slice(0, 12).map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    const priority = ["high", "medium", "low"].includes(String(rec.priority)) ? (rec.priority as RoadmapRow["priority"]) : "medium";
    const slug = rec.template_slug ? String(rec.template_slug) : null;
    const match = slug ? bySlug.get(slug) : undefined;
    let setup = "Custom / TBD";
    let ongoing = "—";
    if (match) {
      setup = match.one_time_label?.trim()
        ? sanitizeDash(match.one_time_label)
        : match.one_time_price != null ? formatUSD(match.one_time_price) : "Custom / TBD";
      ongoing = match.monthly_label?.trim()
        ? sanitizeDash(match.monthly_label)
        : match.monthly_price != null ? `${formatUSD(match.monthly_price)}/mo` : "—";
    }
    return {
      priority,
      item_name: sanitizeDash(rec.item_name) || (match?.name ?? "Untitled item"),
      template_slug: match ? slug : null,
      note: sanitizeDash(rec.note),
      setup_cost_label: setup,
      ongoing_cost_label: ongoing,
      hidden: false,
    };
  }).filter((r) => r.item_name);
}
