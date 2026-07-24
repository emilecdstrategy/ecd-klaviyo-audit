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
            text: { type: "string", description: "The opportunity in ONE short, plain-English sentence. No jargon, no preamble." },
            recommendation: { type: "string", description: "1-2 sentences, founder-friendly and warm, like a strategist not a QA engineer. Lead with the action, then the payoff for the shopper or brand ('Do X. It gives shoppers Y.'). Propose the actual words for any copy (real headline / button label). No jargon (never 'tap target', 'above the fold', 'CTA', 'viewport'). Must be realistic to ship on Shopify." },
            viewport: { type: "string", enum: ["desktop", "mobile", "both"], description: "Which viewport this issue is about. Use 'desktop' or 'mobile' when it is specific to one (judge from the IMG_n you are looking at), or 'both' when it applies equally to both. Prefer a specific viewport over 'both' when the issue is more visible or more severe on one." },
            highlights: {
              type: "array",
              maxItems: 3,
              description:
                "REQUIRED for almost every finding: pinpoint the exact element this finding is about so the reader sees a numbered pin on each screenshot. Provide ONE entry PER image the finding is visible on: for a 'both' finding, give an entry on the desktop IMG_n AND an entry on the matching mobile IMG_n (the same element on each device), so the pin shows on both viewports. For a desktop-only or mobile-only finding, give a single entry on that device's IMG_n. Only omit entirely when the finding has no single on-screen location (e.g. a sitewide or structural issue). Do not leave locatable findings unpinned.",
              items: {
                type: "object",
                required: ["image_ref", "label"],
                properties: {
                  image_ref: { type: "string", description: "The IMG_n label of the screenshot this entry refers to" },
                  element_id: { type: "string", description: "PREFERRED: the id (e.g. el_12) of the matching element from the listed page elements for THIS image; its real on-page box is used automatically" },
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
export type WebFinding = { text: string; recommendation: string; viewport: WebViewportTag; highlight?: WebHighlight; highlights?: WebHighlight[]; hidden: boolean };

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

    // Resolve one raw highlight entry (from `highlights[]` or the legacy single
    // `highlight`) into a stored WebHighlight, preferring the real element box.
    const resolveHighlight = (raw: unknown): WebHighlight | null => {
      const hl = (raw ?? {}) as Record<string, unknown>;
      if (!hl || typeof hl !== "object") return null;
      const ref = String(hl.image_ref ?? "");
      const snapshotId = imageRefToSnapshotId.get(ref);
      if (!snapshotId) return null;
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
      if (!box || box.w <= 0 || box.h <= 0) return null;
      return {
        snapshot_id: snapshotId,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        label: (sanitizeDash(hl.label) || sanitizeDash(box.label)).slice(0, 80),
      };
    };

    // Accept both the new `highlights` array (one pin per viewport) and the legacy
    // single `highlight`. De-dupe by snapshot so each shot gets at most one pin.
    const rawHls = [
      ...(Array.isArray(rec.highlights) ? rec.highlights : []),
      ...(rec.highlight ? [rec.highlight] : []),
    ];
    const highlights: WebHighlight[] = [];
    const seenSnap = new Set<string>();
    for (const raw of rawHls) {
      const resolved = resolveHighlight(raw);
      if (resolved && !seenSnap.has(resolved.snapshot_id)) {
        seenSnap.add(resolved.snapshot_id);
        highlights.push(resolved);
      }
    }

    const rawViewport = String(rec.viewport ?? "").toLowerCase();
    // Infer viewport from the highlights' shots when the model did not tag it.
    const hlViewports = new Set(
      highlights.map((h) => {
        for (const [ref, id] of imageRefToSnapshotId) if (id === h.snapshot_id) return refToViewport?.get(ref);
        return undefined;
      }).filter(Boolean),
    );
    const viewport: WebViewportTag =
      rawViewport === "desktop" || rawViewport === "mobile"
        ? rawViewport
        : rawViewport === "both"
        ? "both"
        : hlViewports.size === 1
        ? ([...hlViewports][0] as WebViewportTag)
        : "both";
    const finding: WebFinding = {
      text: sanitizeDash(rec.text),
      recommendation: sanitizeDash(rec.recommendation),
      viewport,
      highlights,
      highlight: highlights[0],
      hidden: false,
    };
    return finding;
  })
    .filter((f) => f.text)
    // Safety net: drop non-actionable "keep as is / no change needed" findings that
    // slip past the prompt. Positives belong in strengths (pros), not findings.
    .filter((f) => {
      const rec = (f.recommendation || "").toLowerCase().trim();
      const txt = (f.text || "").toLowerCase().trim();
      const noop = /^(keep|leave)\b.{0,24}\bas[ -]?is\b/.test(rec) ||
        /^no (change|changes|fix|action|edits?) (needed|required|necessary)/.test(rec) ||
        /^(keep|leave) (this|it|them) (as is|the same|unchanged)/.test(rec) ||
        (/\bkeep (this|it|as is)\b/.test(rec) && rec.length < 60);
      // Also drop a finding that reads purely as praise with no problem stated.
      const praiseOnly = /(works well|looks great|is (a )?nice|does exactly what|is doing exactly)/.test(txt) &&
        (/^(keep|leave|maintain)\b/.test(rec) || rec.length === 0);
      // Drop grow-zone / planting-location widget findings: it is automatic
      // zip-based detection and 'n/a' before a zip is entered is expected. (Kept
      // narrow to the widget labels so product 'hardiness zone' care details, a
      // legitimate recommendation, are not dropped.)
      const growZone = /growing zone|planting in\b|grow zone/.test(txt + " " + rec);
      return !noop && !praiseOnly && !growZone;
    });
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
