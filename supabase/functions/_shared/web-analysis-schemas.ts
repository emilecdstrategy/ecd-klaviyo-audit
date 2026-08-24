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

/** A list, out of whatever the model actually sent.
 *
 * The schema asks for arrays and the tool call is forced, and the model still
 * sometimes JSON-encodes a whole array into one string. Every array-typed field
 * was read with a bare Array.isArray check, so that reply was silently thrown
 * away: a live product page came back with its findings, pros and
 * recommendations all as strings, both passes, and the audit stopped with
 * "0 findings" as if the model had found nothing to say. It had.
 *
 * Recovery is lossless where it is possible at all, and gives up where it is
 * not. Nothing here invents content. */
export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return [v]; // one item, sent unwrapped
  if (typeof v !== "string") return [];
  const text = v.trim();
  if (!text) return [];
  // The common case: the array is all there, just encoded as text.
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch { /* not JSON after all; fall through */ }
  }
  return [];
}

/** Like asArray, but for arrays of plain strings, where a prose blob can also
 *  be split back into items without guessing at any structure. */
function asStringItems(v: unknown): unknown[] {
  const direct = asArray(v);
  if (direct.length > 0) return direct;
  if (typeof v !== "string" || !v.trim()) return [];
  // Some replies arrive as a tagged list rather than a JSON array: a live retry
  // sent pros as "\n<item>...</item>\n<item>...</item>". The items are right
  // there, so read them rather than throwing the answer away.
  const tagged = [...v.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1].trim()).filter(Boolean);
  if (tagged.length > 0) return tagged;
  return v
    .split(/\r?\n+|(?:^|\s)[-•*]\s+|;\s+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").replace(/^<\/?[a-z][^>]*>|<\/?[a-z][^>]*>$/gi, "").trim())
    .filter((line) => line.length > 2);
}

function strArray(v: unknown, max: number): string[] {
  return asStringItems(v).map(sanitizeDash).filter(Boolean).slice(0, max);
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

// --- Pin placement helpers -------------------------------------------------

const LABEL_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "on", "in", "at", "with",
  "area", "section", "block", "element", "region", "text", "label", "this",
  "div", "span", "img", "image", "link", "icon",
]);

/** Meaningful lowercase tokens from an element or highlight label. */
function labelTokens(raw: unknown): string[] {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/^[a-z0-9]+\s*:\s*/, "") // strip a tag prefix like "button: "
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !LABEL_STOPWORDS.has(t));
}

/** A label that is nothing but a tag name carries no identity: the capture
 * records anonymous nodes as plain "button", "a", "section". Snapping to one
 * puts the pin on whichever unnamed box happened to share a generic word, which
 * is how "Shop the Camping Set button" landed on a hamburger menu. */
const TYPE_ONLY_LABELS = new Set([
  "a", "div", "span", "p", "button", "section", "header", "footer", "nav", "form",
  "img", "ul", "ol", "li", "label", "input", "select", "aside", "main", "article",
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

/** Words that name an element TYPE or a ubiquitous storefront noun. Sharing one
 * of these proves nothing about WHICH element is meant: a finding about "cart
 * icons" shares "cart" with every cart control on the page, and that is how a
 * header finding got pinned to a hidden "GO TO CART" drawer button. */
const GENERIC_TOKENS = new Set([
  "button", "buttons", "link", "links", "menu", "nav", "navigation", "header",
  "footer", "section", "banner", "bar", "row", "column", "block", "group",
  "form", "field", "input", "page", "site", "cart", "bag", "search", "account",
  "login", "shop", "store", "home", "top", "bottom", "left", "right", "main",
  "first", "second", "card", "box", "list", "photo", "picture", "heading",
  // "Subheadline text" shares "text" with half the DOM; "hero area" shares
  // "area" with any container. Sharing one of these is not identity.
  "text", "copy", "area", "space", "content", "icon", "image", "element",
  "item", "items", "label", "title", "wrapper", "container", "region",
]);

/** Does the model's own guessed box land on this element? Its coordinates are
 * rough, so this asks only whether one centre sits inside the other rect. It is
 * weak evidence on its own but strong CORROBORATION: agreeing twice, by id and
 * by position, is unlikely to be a coincidence. */
function boxAgreesWithElement(
  hl: Record<string, unknown>,
  el: ElementBox,
): boolean {
  const x = Number(hl.x);
  const y = Number(hl.y);
  const w = Number(hl.w);
  const h = Number(hl.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) return false;
  const inside = (px: number, py: number, r: ElementBox) =>
    px >= r.x - 2 && px <= r.x + r.w + 2 && py >= r.y - 2 && py <= r.y + r.h + 2;
  const hlCentre: [number, number] = [x + w / 2, y + h / 2];
  const elCentre: [number, number] = [el.x + el.w / 2, el.y + el.h / 2];
  return inside(hlCentre[0], hlCentre[1], el)
    || inside(elCentre[0], elCentre[1], { ...el, x, y, w, h });
}

/** The element the model named by id, with anonymous elements held to a higher
 * bar.
 *
 * The model picks ids out of a numbered list of element labels, so when a label
 * carries text the choice is checkable and has held up in practice. When the
 * label is nothing but a tag name the model is choosing blind, and on a live
 * report a finding about the hero's missing trust line came back as element_id
 * el_7: the LOGO link, captured as the bare tag "a". Nothing in that label could
 * contradict the choice, so the pin sat on the logo.
 *
 * The label scorer already refuses bare-tag elements; the id path skipped it and
 * inherited none of that caution. Now an anonymous element needs the model's own
 * rough box to land on it too, which means it pointed there twice, by id and by
 * position. A logo finding still pins the logo; a hero finding no longer can. */
function resolveElementById(
  elId: string,
  els: ElementBox[],
  hl: Record<string, unknown>,
): ElementBox | undefined {
  if (!elId) return undefined;
  const el = els.find((e) => e.id === elId);
  if (!el) return undefined;
  const raw = String(el.label ?? "").trim().toLowerCase();
  if (raw && !TYPE_ONLY_LABELS.has(raw)) return el;
  return boxAgreesWithElement(hl, el) ? el : undefined;
}

/** The model names elements well ("Sold out button", "Breadcrumb", "Price") but
 * estimates pixel coordinates poorly, which lands pins on the wrong thing. When
 * it did not give a usable element_id, snap its label to the captured element
 * whose own label matches best and use that element's real box instead.
 *
 * Matching has to be conservative in a specific way: a WRONG pin is worse than
 * no pin, because a pin is a claim about where the problem is and the reader
 * checks it against the screenshot. So a candidate needs real evidence of
 * identity, either two shared words or one distinctive one. */
export function snapToElementByLabel(
  highlightLabel: unknown,
  elements: ElementBox[],
): ElementBox | undefined {
  const wanted = labelTokens(highlightLabel);
  if (wanted.length === 0 || elements.length === 0) return undefined;
  let best: { el: ElementBox; score: number } | null = null;
  for (const el of elements) {
    const raw = String(el.label ?? "").trim().toLowerCase();
    if (!raw || TYPE_ONLY_LABELS.has(raw)) continue;
    const have = labelTokens(el.label);
    if (have.length === 0) continue;
    const shared = wanted.filter((t) => have.includes(t));
    if (shared.length === 0) continue;
    // One shared word is only enough when it actually identifies something.
    // Two or more can include generic words, since the combination is specific.
    if (shared.length === 1 && GENERIC_TOKENS.has(shared[0])) continue;
    // And one shared word is not enough when the label said far more than that
    // word. A pin labelled "Hero banner: 25% Off Fall Bulbs" landed on the
    // BULBS item in the nav, because that element's label is one word, so the
    // single overlap scored a perfect match on the element's side while four
    // fifths of the pin's own description went unaccounted for. A one-word
    // element only wins when the pin was essentially about that one word.
    if (shared.length === 1 && wanted.length > 2) continue;
    // Favour matching most of the requested words against a concise label.
    const score = shared.length / Math.max(wanted.length, 1) + shared.length / Math.max(have.length, 1);
    if (!best || score > best.score) best = { el, score };
  }
  // Require a reasonably confident match so we never snap on a single weak token.
  return best && best.score >= 1 ? best.el : undefined;
}

/**
 * The box around the several elements a finding is about.
 *
 * "The phone header bunches search, account and cart all on the right" is about
 * a GROUP, and no single element is it. Label matching needs a distinctive word
 * to identify one element, and every word here is generic on its own: dozens of
 * pages have a thing called "search" and a thing called "cart". So that finding
 * matched nothing and fell back to the model's own guess at coordinates, which
 * landed a row too low, on the growing-zone bar underneath the icons.
 *
 * Together those same generic words are specific. A finding naming search AND
 * cart, on a page that has an element called each, is about both of them, and
 * the box around them is exactly the cluster the sentence describes. Two
 * elements matching two DIFFERENT words is the bar: one generic word shared
 * with one element proves nothing, which is why snapToElementByLabel refuses
 * it.
 */
export function snapToElementGroup(
  findingText: unknown,
  elements: ElementBox[],
): { x: number; y: number; w: number; h: number; ids: string[] } | undefined {
  const wanted = new Set(labelTokens(findingText));
  if (wanted.size === 0 || elements.length < 2) return undefined;

  const hits: ElementBox[] = [];
  const matchedTokens = new Set<string>();
  for (const el of elements) {
    const raw = String(el.label ?? "").trim().toLowerCase();
    if (!raw || TYPE_ONLY_LABELS.has(raw)) continue;
    const mine = labelTokens(el.label).filter((t) => wanted.has(t));
    if (mine.length === 0) continue;
    hits.push(el);
    for (const t of mine) matchedTokens.add(t);
  }
  // Two elements, and between them at least two different words from the
  // sentence: one word echoed by two elements is one thing named twice.
  if (hits.length < 2 || matchedTokens.size < 2) return undefined;

  const x = Math.min(...hits.map((e) => e.x));
  const y = Math.min(...hits.map((e) => e.y));
  const right = Math.max(...hits.map((e) => e.x + e.w));
  const bottom = Math.max(...hits.map((e) => e.y + e.h));
  const w = right - x;
  const h = bottom - y;
  // A pin is a place to look. Once the box covers most of the screen it has
  // stopped pointing at anything, and the model's own guess is no worse.
  if (w <= 0 || h <= 0 || w > 70 || h > 22) return undefined;
  return { x, y, w, h, ids: hits.map((e) => e.id) };
}

/** A photograph as the capture recorded it, in percentages of the shot. */
export type PhotoBox = { x: number; y: number; w: number; h: number };

const HERO_WORDS = new RegExp(
  ["hero", "banner", "masthead", "above the fold", "first screen", "opening image", "main image", "slide", "carousel"].join("|"),
  "i",
);

/**
 * Where the hero actually is, for a finding that is about it.
 *
 * A homepage hero is usually one big photograph with its words baked into the
 * pixels, so the DOM has no element carrying "25% OFF FALL BULBS" and no amount
 * of label matching can find it. Every other route fails and the pin falls back
 * to the model's guess at coordinates, which put the hero at the bottom of the
 * page on a live report.
 *
 * The capture already inventories every photograph it painted, with boxes. The
 * biggest one starting in the top half of the shot IS the hero, which is a fact
 * rather than an estimate.
 */
export function snapToHeroPhoto(text: unknown, photos: PhotoBox[]): PhotoBox | undefined {
  if (!HERO_WORDS.test(String(text ?? ""))) return undefined;
  const candidates = (photos ?? []).filter((p) => p && p.w >= 50 && p.h >= 10 && p.y < 60);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, p) => (p.w * p.h > best.w * best.h ? p : best));
}

// --- Cross-section duplicate detection -------------------------------------

const DUP_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "on", "in", "at", "with", "is",
  "are", "was", "be", "it", "its", "this", "that", "there", "no", "not", "but",
  "so", "you", "your", "they", "their", "them", "can", "could", "would", "just",
  "which", "when", "who", "has", "have", "sits", "sit", "look", "looks", "page",
  "pages", "shoppers", "shopper", "visitors", "visitor", "screen", "phones",
  "phone", "mobile", "desktop", "devices", "both", "right", "near", "very",
  "into", "onto", "from", "than", "then", "also", "each", "other", "same", "own",
]);

/** Furniture that is identical on every page of a storefront. Whatever page it
 * is spotted on, it is the SAME issue, so the audit should raise it once. Keyed
 * so a later section can be blocked from repeating a topic already covered. */
const SITEWIDE_TOPIC_PATTERNS: Array<{ topic: string; re: RegExp }> = [
  { topic: "announcement_bar", re: /announcement bar|free[- ]shipping (bar|banner|message)|promo bar|top bar/ },
  { topic: "main_nav", re: /top navigation|main navigation|nav bar|navigation bar|menu items|menu categories|top-level categor|main menu|shop by brands/ },
  { topic: "floating_widgets", re: /chat (bubble|widget|launcher|button)|loyalty badge|rewards badge|floating badge|floating (icon|widget|button)|back to top/ },
  { topic: "header_chrome", re: /\bheader\b|logo (sits|is|placement)|search icon|cart icon/ },
  { topic: "footer", re: /\bfooter\b/ },
];

const FLOATING_WIDGET_RE =
  /chat (bubble|widget|launcher|icon|button)|loyalty badge|rewards badge|floating (badge|icon|widget|button)|back to top/;
// Evidence that widgets actually collide: another widget alongside, or the
// widget sitting over something the shopper needs.
const WIDGET_COLLISION_RE =
  /overlap|on top of|stack|collid|cover(s|ing|ed)?\b|block(s|ing|ed)?\b|each other|obscur/;
const SECOND_WIDGET_RE =
  /(chat[^.]{0,40}(badge|loyalty|rewards|star))|((badge|loyalty|rewards|star)[^.]{0,40}chat)|both (icons|badges|widgets|buttons)|two (icons|badges|widgets)/;

/** A lone chat bubble pinned in a corner is a storefront convention, not a
 * defect, however "crowded" it looks. Only a real collision (two widgets on each
 * other, or one covering content) is worth a finding, so drop the rest. */
export function isLoneFloatingWidgetNitpick(text: string, recommendation: string): boolean {
  const blob = `${text} ${recommendation}`.toLowerCase();
  if (!FLOATING_WIDGET_RE.test(blob)) return false;
  if (WIDGET_COLLISION_RE.test(blob)) return false;
  if (SECOND_WIDGET_RE.test(blob)) return false;
  return true;
}

/** Which sitewide topic (if any) a finding is about. */
export function sitewideTopic(text: string): string | null {
  const t = (text || "").toLowerCase();
  for (const { topic, re } of SITEWIDE_TOPIC_PATTERNS) if (re.test(t)) return topic;
  return null;
}

function dupTokens(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !DUP_STOPWORDS.has(t)),
  );
}

/** Is this finding essentially something already reported in an earlier section?
 * Sitewide furniture (header, nav, announcement bar, floating chat and loyalty
 * widgets) shows up on every page, and re-flagging it in each section is just
 * noise. Compares meaningful content words, so a reworded restatement of the
 * same issue is still caught. */
export function isNearDuplicateFinding(text: string, priorTexts: string[]): boolean {
  const mine = dupTokens(text);
  if (mine.size < 3) return false;
  for (const prior of priorTexts) {
    const theirs = dupTokens(prior);
    if (theirs.size < 3) continue;
    let shared = 0;
    for (const t of mine) if (theirs.has(t)) shared += 1;
    // Overlap relative to the SHORTER set: a terse restatement of a longer
    // earlier finding still counts as the same issue.
    const ratio = shared / Math.min(mine.size, theirs.size);
    if (ratio >= 0.6) return true;
  }
  return false;
}

// --- Tool schemas (forced via tool_choice) ---------------------------------

export const PAGE_AUDIT_TOOL: LlmTool = {
  name: "record_page_audit",
  description: "Record the audit of this page: a short intro, strengths (pros), issues (findings, each optionally pinpointing a region of a referenced screenshot), and prioritized recommendations.",
  input_schema: {
    type: "object",
    required: ["intro", "findings", "recommendations"],
    properties: {
      intro: { type: "string", description: "REQUIRED, never empty. The section summary shown at the top of this page's section: 2-3 sentences in the founder-friendly voice describing where this page stands, what it does well, and what is holding it back. Always write this before anything else." },
      pros: { type: "array", items: { type: "string" }, description: "What already works well on this page" },
      findings: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          required: ["text", "recommendation"],
          properties: {
            text: { type: "string", description: "The opportunity in ONE short, plain-English sentence. No jargon, no preamble." },
            recommendation: { type: "string", description: "REQUIRED, never empty. Every finding must state its fix. 1-2 sentences, founder-friendly and warm, like a strategist not a QA engineer. Lead with the action, then the payoff for the shopper or brand ('Do X. It gives shoppers Y.'). Propose the actual words for any copy (real headline / button label). No jargon (never 'tap target', 'above the fold', 'CTA', 'viewport'). Must be realistic to ship on Shopify." },
            viewport: { type: "string", enum: ["desktop", "mobile", "both"], description: "Which viewport this issue is about. Use 'desktop' or 'mobile' when it is specific to one (judge from the IMG_n you are looking at), or 'both' when it applies equally to both. Prefer a specific viewport over 'both' when the issue is more visible or more severe on one." },
            highlights: {
              type: "array",
              maxItems: 3,
              description:
                "REQUIRED for almost every finding: pinpoint the exact element this finding is about so the reader sees a numbered pin on each screenshot. Provide ONE entry PER image the finding is visible on: for a 'both' finding, give an entry on the desktop IMG_n AND an entry on the matching mobile IMG_n (the same element on each device), so the pin shows on both viewports. For a desktop-only or mobile-only finding, give a single entry on that device's IMG_n. Only omit entirely when the finding has no single on-screen location (e.g. a sitewide or structural issue). Do not leave locatable findings unpinned.",
              items: {
                type: "object",
                required: ["image_ref", "label", "x", "y", "w", "h"],
                properties: {
                  image_ref: { type: "string", description: "The IMG_n label of the screenshot this entry refers to" },
                  element_id: { type: "string", description: "PREFERRED alongside x/y/w/h, never instead of them: the id (e.g. el_12) of the element from the listed page elements for THIS image whose label actually matches the thing this finding is about (match on the label text, e.g. an 'a: SHOP NOW' element for a finding about the hero button). Its real on-page box is used automatically. If no listed element genuinely matches the finding's subject, omit element_id and give x/y/w/h instead, or omit the highlight entirely. NEVER attach the pin to an unrelated element (for example the cart or search icon) just to have one." },
                  x: { type: "number", description: "ALWAYS REQUIRED, even when you give element_id: left edge of a tight box around the thing, % of image width (0-100). Your box is what confirms the element_id really is the thing you mean, and it is what the pin falls back to when no listed element matches. A highlight with no box may be dropped entirely." },
                  y: { type: "number", description: "ALWAYS REQUIRED: top edge of the box, % of image height (0-100)" },
                  w: { type: "number", description: "ALWAYS REQUIRED: box width, % of image width" },
                  h: { type: "number", description: "ALWAYS REQUIRED: box height, % of image height" },
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
  description:
    "Record the store's backend performance as a short set of PLAYS: things the team could ship this month, each anchored to a real number from the data. This section is read by a strategist deciding what to do next, not by someone who wants the numbers narrated back.",
  input_schema: {
    type: "object",
    required: ["intro", "plays"],
    properties: {
      intro: { type: "string", description: "ONE sentence, max 25 words, on where the store stands. Never list the metrics; they are shown as cards." },
      plays: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        description:
          "Highest impact first. AOV levers before margin, margin before catalog. One play per idea; never two plays about the same lever.",
        items: {
          type: "object",
          required: ["title", "insight", "action_steps", "metric"],
          properties: {
            title: { type: "string", description: "3 to 6 words naming the opportunity, e.g. 'Lift the single-item basket'." },
            insight: {
              type: "string",
              description:
                "ONE sentence stating what the data shows, and it MUST quote a real figure from the data provided (a percentage, a count, a money amount). No hedging, no advice here.",
            },
            action_steps: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              description:
                "The work, as 1 to 3 short steps, each a single imperative clause under about 18 words, concrete enough to brief a developer or a merchandiser. No 'consider', no 'explore', no 'optimize'. Shown as a bullet list, so no numbering or leading dashes.",
              items: { type: "string" },
            },
            products: {
              type: "array",
              maxItems: 3,
              description:
                "Titles of products this play is about, copied EXACTLY from basket.top_products_by_units or basket.frequent_pairs. The report renders each as a card with its real photo, price and a link to the live product page, so a title that does not match the data exactly renders nothing. Leave empty for plays that are not about specific products.",
              items: { type: "string" },
            },
            metric: { type: "string", description: "The headline figure alone, for display on the card, e.g. '70% single-item orders' or '$100 threshold vs $38 median'." },
            window: { type: "string", description: "The window this figure came from, e.g. 'last 30 days' or 'last 90 days'. Use exactly the window the data says it used." },
          },
        },
      },
      // DEPRECATED, do not fill. Per-metric commentary was the old shape of this
      // section and nothing renders it for new audits; the field remains only so
      // audits generated before plays existed keep displaying. Leaving it in the
      // schema without this note had the model dutifully writing five paragraphs
      // per audit that no reader ever sees.
      // No maxItems: 0 here. It is legal JSON Schema but unusual enough that the
      // provider rejected or mangled the tool definition, and the model came
      // back with an intro and no plays at all. Deprecation is communicated in
      // the description instead, which the model honours.
      metrics: {
        type: "array",
        description: "Deprecated, always return an empty array. Put everything in plays.",
        items: {
          type: "object",
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
  description: "Turn the findings into a prioritized roadmap. Match each item to a catalog service by its slug when one fits; otherwise leave template_slug null. Never state prices: setup cost is calculated from your setup_hours estimate at the agency's hourly rate.",
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
            setup_hours: {
              type: "number",
              minimum: 0.5,
              maximum: 40,
              description: "Implementation effort for one competent developer, in half-hour steps (0.5, 1, 1.5, 2.5...). Estimate the build only: not discovery, QA rounds or client meetings. A copy or CSS tweak is 0.5, a new section or component is 2 to 4, a page rebuilt or a flow reworked is 8 or more.",
            },
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

export type ElementBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Whether this element is, or wraps, a control that is currently collapsed.
   *  Read for every element: see CapturedElement in browserless.ts. */
  toggle?: "collapsed" | "expanded";
  /** How a button, link or field is actually painted, measured at capture time.
   *  Present only on interactive elements; see ElementStyle in browserless.ts. */
  style?: {
    fill: "filled" | "outlined" | "bare";
    bg: string;
    fg: string;
    radius: number;
    border: number;
    bold: boolean;
    font: number;
    toggle?: "collapsed" | "expanded";
  };
};

/** The cart is photographed with ONE item we added ourselves, so its blank space
 * is an artifact of our capture and never a defect of the store. The KB has said
 * so for a while and the model kept submitting it anyway, twice with a fix that
 * admitted it was a non-issue, so the topic is now refused in code. */
/**
 * Work this audit does not recommend, and instructions that are not work.
 *
 * Page speed is not measured anywhere in this pipeline, so a recommendation
 * about it is advice we cannot stand behind, and it is not what the team sells.
 * Separately, a step that tells the client to audit, review or investigate
 * something hands the job back to the person reading the audit. They are paying
 * for the answer, not for a list of things to go and look at.
 */
const BANNED_WORK = [
  /\b(page ?speed|site ?speed|load(ing)? (speed|time)|core web vitals|largest contentful paint|\bLCP\b|\bCLS\b|\bTTFB\b|lazy ?load|image compression|compress (the |your )?images?|minify|\bCDN\b|browser cach\w+)/i,
];

const DIAGNOSTIC_STEP = [
  /^\s*(audit|review|analy[sz]e|investigate|examine|assess|benchmark|measure|recheck|re-check|revisit|monitor|track|verify|confirm|evaluate|check)\b/i,
  /\b(run|do|perform|conduct) (an|a|another) (audit|analysis|review|assessment)\b/i,
  /\baudit (your|the|this|each|every|product|collection|cart|checkout|site|store|page)/i,
];

/**
 * Advice that presumes something about the store we never checked.
 *
 * A play told a client to "Turn on Shopify's abandoned checkout emails" and to
 * "Simplify checkout to one page if your current theme still splits it into
 * multiple steps". This audit never opens the checkout, never reads the
 * notification settings and never inspects the theme, so both were guesses
 * written as instructions. A client who already has those emails on reads it
 * and concludes we did not look.
 *
 * Three shapes, all of them a guess about the current setup:
 *  - a conditional hedge: "if your theme still...", "if you have not already"
 *  - switching on a feature whose state we never read: "turn on", "enable"
 *  - a change to the checkout page itself, which is never captured
 *
 * Proposing NEW work is fine and is not this: "send a follow-up email 30 days
 * after purchase" claims nothing about what exists today.
 */
const PRESUMES_SETUP = [
  // "if your current theme still splits it", "if you have not already done this"
  new RegExp(
    String.raw`\bif (you|your|they|their|the|this|that|it|there)\b[^.]{0,70}\b(already|currently|still|not|isn't|aren't|haven't|hasn't|don't|doesn't)\b`,
    "i",
  ),
  new RegExp(String.raw`\bif not already\b|\bunless you already\b|\bassuming (you|your|it|they)\b`, "i"),
  // Flipping a switch we never looked at.
  new RegExp(
    String.raw`\b(turn|switch) (it |them |these |this )?(on|off)\b|\b(enable|activate|disable|deactivate)\b`,
    "i",
  ),
  // The checkout page is never captured, so nothing about its own layout,
  // steps or fields can be evidenced. Findings about what leads INTO checkout
  // are fine; this is about changing the checkout itself.
  new RegExp(
    String.raw`\b(one|single).page checkout\b|\bmulti.?(step|page) checkout\b|\bcheckout (in)?to (one|a single) page\b|\bsimplify (the )?checkout\b|\bcheckout (page|flow|form) (layout|fields?|steps?)\b`,
    "i",
  ),
];

/** True when a step is a guess about the store's current configuration. */
export function presumesSetup(text: unknown): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return PRESUMES_SETUP.some((re) => re.test(t));
}

/** True when a line of advice is something we refuse to ship. */
export function isBannedWork(text: unknown): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return BANNED_WORK.some((re) => re.test(t));
}

/** True when a "step" is really an instruction to go and investigate. */
export function isDiagnosticStep(text: unknown): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return DIAGNOSTIC_STEP.some((re) => re.test(t));
}

/**
 * What a cart can already be saying about shipping.
 *
 * Three different families, because a finding claiming the cart is silent is
 * wrong if ANY of them is on the page: the tax-and-shipping disclosure Shopify
 * prints under the total, a delivery estimate, or a dispatch time. A live cart
 * carried "MOST ORDERS SHIP WITHIN ONE BUSINESS DAY" and "Estimated delivery
 * between: Aug 24, 2026-Aug 26, 2026" and the audit still said the drawer never
 * mentions how long shipping takes.
 */
const SHIPPING_DISCLOSURE_RE = new RegExp(
  [
    // Taxes and shipping calculated at checkout.
    "(tax(es)?|duties)[^.]{0,60}(shipping|delivery)[^.]{0,60}(calculated|estimated|added|applied)",
    "calculated at (the )?checkout",
    // A delivery estimate, as a date range or a day count. String.raw, because
    // three of these shipped as plain strings whose \d, \s and \w had collapsed
    // to bare letters: "Ships in 2 days" and "3-5 business days" matched
    // nothing, so a cart whose only disclosure was a dispatch time was still
    // called silent about shipping.
    "estimated (delivery|arrival|ship)",
    String.raw`(delivery|arriv\w*) (between|by|on|in) `,
    "arrives? (by|between|in|on) ",
    // A dispatch time.
    String.raw`ship(s|ped|ping)? (within|in) \d`,
    "ship(s|ped|ping)? within (one|two|three|a|the same)",
    String.raw`\d+\s*(-|to)?\s*\d*\s*business day`,
  ].join("|"),
  "i",
);

/** A finding claiming the cart says nothing about what shipping will cost. */
const NO_SHIPPING_INFO_RE =
  /\b(no|not|never|nothing|none|without|missing|absent|lacks?|fails? to|does ?n[o']?t|do ?n[o']?t|is ?n[o']?t)\b[^.]{0,90}\b(shipping|delivery|tax(es)?|duties|freight)\b/i;

/** The finding is allowed to stand when it ACKNOWLEDGES the disclosure and asks
 *  for something more, such as a real delivery estimate. That is a different
 *  and legitimate point; what is refused is claiming the line is not there. */
const ACKNOWLEDGES_DISCLOSURE_RE = new RegExp(
  [
    "calculated at (the )?checkout",
    "estimated (delivery|arrival|ship)",
    "delivery (estimate|date|window|range)",
    "ship(s|ping)? within",
    "business day",
    "free shipping (over|above|on orders)",
  ].join("|"),
  "i",
);

// Any flavour of "there is space here". The cart is photographed with the one
// item WE added, so its roominess is an artifact of our capture rather than
// anything the store did. The list grew by one adjective at a time as the model
// found new ways to say it: "a lot of open white space" walked straight through
// a pattern that required the word "empty" to come first, so the adjectives are
// now a set rather than a fixed phrase.
/** Reassurance a cart can already be carrying. */
const TRUST_PRESENT_RE = new RegExp(
  [
    "protected checkout",
    "order protection",
    "protect(ion)? (from|against)",
    "secure(ly)? (checkout|payment)",
    "money.?back",
    "guarantee",
    "warranty",
    "free returns",
    "returns? within",
    "buyer protection",
  ].join("|"),
  "i",
);

/** A finding claiming the cart offers no reassurance at all. */
const NO_TRUST_CLAIM_RE = new RegExp(
  [
    "\\b(no|not|never|nothing|none|without|missing|absent|lacks?|fails? to|does ?n[o']?t|do ?n[o']?t)\\b",
    "[^.]{0,90}",
    "\\b(trust|reassur\\w*|guarantee|protection|protected|returns?|warranty|secure|safety|safe)\\b",
  ].join(""),
  "i",
);

/** The finding names the thing that IS there, so it is asking for more rather
 *  than claiming there is nothing. That is a fair point and it stands. */
const ACKNOWLEDGES_TRUST_RE = new RegExp(
  ["protected checkout", "order protection", "protect from damage", "already (says|shows|has|offers)"].join("|"),
  "i",
);

/**
 * Proof, from the shot itself, that the cart we photographed had something in it.
 *
 * The cart section is hidden unless the capture can show the cart was populated,
 * because a "Cart" section describing the homepage is worse than no section. That
 * test used to accept only two things: an item count read back from /cart.js, or
 * a /cart URL. Power Planter's bot protection blocks that fetch while serving the
 * page perfectly, so a capture came back with a flawless slide-cart drawer, one
 * item, "CHECKOUT $23.49" across the button, and no count. The section was hidden
 * anyway.
 *
 * A checkout control or a total carrying an actual amount is the discriminator: a
 * homepage header has a cart icon and often a "free shipping over $100" bar, but
 * it never says "CHECKOUT $23.49". Requiring the money next to the word is what
 * keeps "taxes and shipping calculated at checkout" from counting.
 */
const CART_POPULATED_RE = new RegExp(
  String.raw`(checkout|subtotal|order total|cart total)[^a-z0-9]{0,12}\$\s?\d`,
  "i",
);

/** Whether any captured element on these shots shows a populated cart. */
export function cartLooksPopulated(
  rows: Array<{ elements?: ElementBox[] | null }>,
): boolean {
  for (const row of rows ?? []) {
    const els = (row?.elements ?? []) as ElementBox[];
    for (const el of els) {
      if (CART_POPULATED_RE.test(String(el?.label ?? ""))) return true;
    }
  }
  return false;
}

const CART_EMPTINESS_RE = new RegExp(
  [
    // A qualifier, then "space" within a short window. The adjectives stack
    // ("a lot of open white space"), so enumerating their orders does not work.
    String.raw`\b(?:empty|blank|dead|white|open|unused|negative|excess|extra|large|lots? of)\b[\w\s]{0,20}?\bspace\b`,
    "whitespace",
    "large gap",
    "big gap",
    String.raw`looks (sparse|empty|bare)`,
    String.raw`feels (sparse|empty|unbalanced)`,
    "unbalanced",
    "sparse",
  ].join("|"),
  "i",
);

export function coercePageAudit(
  input: unknown,
  imageRefToSnapshotId: Map<string, string>,
  refToElements?: Map<string, ElementBox[]>,
  refToViewport?: Map<string, string>,
  /** Which page this is, so page-specific refusals can apply. */
  pageType?: string,
  /** Every photograph the capture painted, per image, for anchoring a finding
   *  about the hero when the DOM has no element for it. */
  refToPhotos?: Map<string, PhotoBox[]>,
) {
  const o = (input ?? {}) as Record<string, unknown>;
  // Every word the capture found on these screenshots. A claim that the page
  // does not mention something is checkable against this.
  const pageText = [...(refToElements?.values() ?? [])]
    .flat()
    .map((el) => el.label ?? "")
    .join(" | ")
    .toLowerCase();
  const findingsRaw = asArray(o.findings);
  const findings: WebFinding[] = findingsRaw.slice(0, 8).map((f) => {
    const rec = (f ?? {}) as Record<string, unknown>;

    // Resolve one raw highlight entry (from `highlights[]` or the legacy single
    // `highlight`) into a stored WebHighlight, preferring the real element box.
    const resolveHighlight = (raw: unknown, lenient = false): WebHighlight | null => {
      const hl = (raw ?? {}) as Record<string, unknown>;
      if (!hl || typeof hl !== "object") return null;
      const ref = String(hl.image_ref ?? "");
      const snapshotId = imageRefToSnapshotId.get(ref);
      if (!snapshotId) return null;
      const els = refToElements?.get(ref) ?? [];
      const elId = typeof hl.element_id === "string" ? hl.element_id.trim() : "";
      // Best: the element the model pointed at. Next best: the element whose
      // label matches what the model called it (its coordinates are unreliable).
      // Last resort: the model's own box.
      // Third try: the finding's own sentence. The model invents pin labels that
      // describe a POSITION rather than a thing ("second product card edge",
      // "empty space below item"), which matches no captured element, so the pin
      // fell back to the model's guessed box and landed on the wrong thing (a
      // live report pinned the recommendations row over the cart total). The
      // finding text almost always names the real element ("the You may also
      // like row only shows two products"), and the scorer already demands most
      // of a concise element label be present, so a long sentence cannot snap on
      // one weak token.
      // In order of how much each source knows about what is being pointed at:
      //
      //  1. the element the model named outright
      //  2. the pin's own label, which is its statement of the one thing it means
      //  3. the group the SENTENCE names, when it names several things
      //  4. one thing named somewhere in the sentence
      //  5. the model's coordinates, its weakest output
      //
      // The group sits above 4 deliberately. "search, account and cart are all
      // bunched on the right" contains the word "cart", so step 4 matched the
      // cart icon and pinned that alone: the right row, a third of the thing the
      // sentence is about. A sentence naming several elements is about all of
      // them.
      const el = resolveElementById(elId, els, hl) ??
        snapToElementByLabel(hl.label, els);
      const group = snapToElementGroup(rec.text, els);
      // A pin that names ONE member of the row the sentence is about should
      // cover the row. The model pinned "icon-cart" for a finding about search,
      // account and cart being bunched together: the right place, a third of the
      // subject. Widening only ever grows a pin to include its siblings, and
      // only when the sentence named them; it can never move it elsewhere.
      const widenToGroup = Boolean(group && (!el || group.ids.includes(el.id)));
      const fallbackEl = el || widenToGroup ? null : snapToElementByLabel(rec.text, els);
      const named = widenToGroup ? null : (el ?? fallbackEl);
      // Last resort before the model's coordinates: if this is a finding about
      // the hero, the hero is a photograph and we know where it is.
      const hero = named || widenToGroup
        ? null
        : snapToHeroPhoto(`${hl.label ?? ""} ${rec.text ?? ""}`, refToPhotos?.get(ref) ?? []);
      let box: { x: number; y: number; w: number; h: number; label?: string } | null = null;
      if (named) {
        box = { x: clampPct(named.x), y: clampPct(named.y), w: clampPct(named.w), h: clampPct(named.h), label: named.label };
      } else if (widenToGroup && group) {
        box = { x: clampPct(group.x), y: clampPct(group.y), w: clampPct(group.w), h: clampPct(group.h) };
      } else if (hero) {
        box = { x: clampPct(hero.x), y: clampPct(hero.y), w: clampPct(hero.w), h: clampPct(hero.h) };
      } else {
        const w = clampPct(hl.w);
        const h = clampPct(hl.h);
        if (w > 0 && h > 0) box = { x: clampPct(hl.x), y: clampPct(hl.y), w, h };
      }
      if (!box || box.w <= 0 || box.h <= 0) return null;
      // A box hugging the bottom edge of the crop is almost always a coordinate
      // guess at content that continues below the shot. Pinning there points at
      // nothing, so drop the pin rather than show it in the wrong place.
      if (box.y >= 92 && !named && !widenToGroup && !hero && !lenient) return null;
      // Lenient pass: slide a bottom-hugging box up so the whole pin sits in the
      // frame. It is an approximation of where the model was pointing, but a
      // roughly placed pin beats no pin at all.
      if (lenient && !named && !widenToGroup && !hero && box.y + box.h > 100) {
        box = { ...box, h: Math.min(box.h, 12), y: Math.max(0, 100 - Math.min(box.h, 12)) };
      }
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
      ...asArray(rec.highlights),
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
    // Dropping every pin leaves a finding with nothing to point at, which reads
    // as a bug in the report. If the strict pass rejected them all, keep the
    // model's own boxes, pulled back inside the frame so they stay visible.
    if (!highlights.length) {
      for (const raw of rawHls) {
        const resolved = resolveHighlight(raw, true);
        if (resolved && !seenSnap.has(resolved.snapshot_id)) {
          seenSnap.add(resolved.snapshot_id);
          highlights.push(resolved);
        }
      }
    }

    if (rawHls.length > 0 && highlights.length === 0) {
      // Every pin on this finding was refused. That is sometimes right (an
      // anonymous id with nothing to corroborate it), but it is invisible in the
      // report, so it goes in the log rather than passing quietly.
      console.warn(JSON.stringify({
        event: "pins_all_dropped",
        finding: String(rec.text ?? "").slice(0, 80),
        raw: rawHls.map((h) => {
          const o = (h ?? {}) as Record<string, unknown>;
          return {
            ref: String(o.image_ref ?? ""),
            element_id: String(o.element_id ?? ""),
            has_box: Number(o.w) > 0 && Number(o.h) > 0,
            label: String(o.label ?? "").slice(0, 40),
          };
        }),
      }));
    }

    const rawViewport = String(rec.viewport ?? "").toLowerCase();
    // Infer viewport from the highlights' shots when the model did not tag it.
    const hlViewports = new Set(
      highlights.map((h) => {
        for (const [ref, id] of imageRefToSnapshotId) if (id === h.snapshot_id) return refToViewport?.get(ref);
        return undefined;
      }).filter(Boolean),
    );
    let viewport: WebViewportTag =
      rawViewport === "desktop" || rawViewport === "mobile"
        ? rawViewport
        : rawViewport === "both"
        ? "both"
        : hlViewports.size === 1
        ? ([...hlViewports][0] as WebViewportTag)
        : "both";
    // MIRROR a "both" finding's pin onto the viewport that has none. The prompt
    // asks for one pin per image and the model routinely obeys on one viewport
    // only: on a live report every collection-page pin sat on the desktop shot,
    // so switching the report to Mobile showed findings with no pins at all,
    // which reads as broken. The report filters findings by viewport, so a
    // "both" finding MUST be able to point at something on either device.
    //
    // Mirroring is by element label, never by copying coordinates: the same
    // element sits somewhere completely different on a phone, and a copied box
    // would be confidently wrong. If the element cannot be found on the other
    // shot, no pin is added.
    if (viewport === "both" && refToElements && refToViewport) {
      const pinnedViewports = new Set([...hlViewports]);
      for (const [ref, snapId] of imageRefToSnapshotId) {
        const vp = refToViewport.get(ref);
        if (!vp || pinnedViewports.has(vp) || seenSnap.has(snapId)) continue;
        const els = refToElements.get(ref) ?? [];
        let mirrored: WebHighlight | null = null;
        for (const src of highlights) {
          const el = snapToElementByLabel(src.label, els) ?? snapToElementByLabel(rec.text, els);
          if (!el) continue;
          mirrored = {
            snapshot_id: snapId,
            x: clampPct(el.x),
            y: clampPct(el.y),
            w: clampPct(el.w),
            h: clampPct(el.h),
            label: src.label,
          };
          break;
        }
        if (mirrored && mirrored.w > 0 && mirrored.h > 0) {
          highlights.push(mirrored);
          seenSnap.add(snapId);
          pinnedViewports.add(vp);
        }
      }
    }

    // A "both" finding that can only be pinned on ONE viewport belongs to that
    // viewport. Mirroring fails legitimately when the subject is not in the other
    // shot at all: on a phone the product image fills the screen, so the price
    // and the Notify me button sit below the fold and are absent from the mobile
    // capture. Leaving the finding tagged "both" listed it under Mobile with no
    // pin to point at, which is what the report looked like on lazyleaf's product
    // page (three findings, one pin). Retagging keeps the finding, on the
    // viewport whose screenshot can actually evidence it.
    //
    // Only when pins EXIST: a finding with no pins anywhere is a general
    // observation that legitimately applies to both, so it keeps its tag.
    if (viewport === "both" && highlights.length > 0) {
      const pinnedVps = new Set<string>();
      for (const h of highlights) {
        for (const [ref, id] of imageRefToSnapshotId) {
          if (id === h.snapshot_id) {
            const vp = refToViewport?.get(ref);
            if (vp) pinnedVps.add(vp);
          }
        }
      }
      if (pinnedVps.size === 1) {
        const only = [...pinnedVps][0];
        if (only === "desktop" || only === "mobile") viewport = only;
      }
    }

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
    // A finding with no fix renders as an empty "Recommended fix" box, so treat a
    // blank recommendation as an incomplete finding and drop it. `recommendation`
    // is also required in the tool schema, so this should not normally trigger.
    .filter((f) => f.text && f.recommendation)
    // Safety net: drop non-actionable "keep as is / no change needed" findings that
    // slip past the prompt. Positives belong in strengths (pros), not findings.
    .filter((f) => {
      const rec = (f.recommendation || "").toLowerCase().trim();
      const txt = (f.text || "").toLowerCase().trim();
      const blob = txt + " " + rec;
      const noop = /^(keep|leave)\b.{0,24}\bas[ -]?is\b/.test(rec) ||
        /^no (change|changes|fix|action|edits?) (needed|required|necessary)/.test(rec) ||
        /^(keep|leave) (this|it|them) (as is|the same|unchanged)/.test(rec) ||
        (/\bkeep (this|it|as is)\b/.test(rec) && rec.length < 60) ||
        // These clauses were anchored to the START of the recommendation, so a
        // finding that buried its own retraction mid-sentence sailed through: a
        // live report shipped "the cart has a lot of empty space" whose fix read
        // "this is only because we tested with one item in the cart, so no change
        // is needed for that specific gap, but consider...". A finding that admits
        // it is not a problem is not a finding, wherever it admits it.
        /\bno (change|changes|fix|action|edits?) (is |are )?(needed|required|necessary)\b/.test(rec) ||
        /\bnot (really )?(an|a real) (issue|problem)\b/.test(rec) ||
        // Artifacts of OUR capture rather than the store: the single test item we
        // added in order to photograph the cart, and the viewport crop.
        /\b(we|you) (only )?tested with\b/.test(rec) ||
        /\bartifact of (our|the) (test|capture)\b/.test(rec) ||
        /\bnothing to (fix|change|do|address)\b/.test(rec) ||
        /\bwill (naturally |simply )?fill (this|that|the) space\b/.test(rec);
      // Also drop a finding that reads purely as praise with no problem stated.
      const praiseOnly = /(works well|looks great|is (a )?nice|does exactly what|is doing exactly)/.test(txt) &&
        (/^(keep|leave|maintain)\b/.test(rec) || rec.length === 0);
      // The cart is photographed with one item WE added, so its blank space is
      // an artifact of our capture. Refused in code because the KB rule saying
      // so was ignored three times running.
      if (pageType === "cart" && CART_EMPTINESS_RE.test(txt)) return false;
      // "The cart says nothing about shipping" when the line under the total
      // says taxes and shipping are calculated at checkout. Shopify prints that
      // on nearly every store, it was in the captured labels, and the audit
      // said it was not there. A finding that ACKNOWLEDGES the line and asks
      // for a real delivery estimate is a different and fair point, so only the
      // claim of absence is refused.
      if (
        pageType === "cart" &&
        SHIPPING_DISCLOSURE_RE.test(pageText) &&
        // Judged on the finding's TEXT, never on its fix. A fix that asks for
        // "Arrives in X business days" naturally contains the very words the
        // page would need, which read as proof the page already said them and
        // let the false claim through.
        NO_SHIPPING_INFO_RE.test(txt) &&
        !ACKNOWLEDGES_DISCLOSURE_RE.test(txt)
      ) {
        console.warn(JSON.stringify({
          event: "finding_refused",
          reason: "cart_already_states_shipping",
          finding: String(f.text ?? "").slice(0, 120),
        }));
        return false;
      }
      // "The cart drawer never mentions returns or a guarantee" on a cart
      // offering Order Protection against damage, loss and theft, under a
      // button that says Protected Checkout. Same shape as the shipping claim:
      // the words are on the page and in the captured labels.
      if (
        pageType === "cart" &&
        TRUST_PRESENT_RE.test(pageText) &&
        NO_TRUST_CLAIM_RE.test(txt) &&
        !ACKNOWLEDGES_TRUST_RE.test(txt)
      ) {
        console.warn(JSON.stringify({
          event: "finding_refused",
          reason: "cart_already_shows_protection",
          finding: String(f.text ?? "").slice(0, 120),
        }));
        return false;
      }
      // Drop grow-zone / planting-location widget findings: it is automatic
      // zip-based detection and 'n/a' before a zip is entered is expected. The
      // model renames it ("location fields", "personalization bar", "location
      // detector"), so match those phrasings too, not just the literal labels.
      // Still scoped to widget-ish wording so a product 'hardiness zone' care
      // detail, a legitimate recommendation, is not dropped.
      // A single floating widget in a corner is normal, not a defect.
      const loneWidget = isLoneFloatingWidgetNitpick(txt, rec);
      const growZone =
        /growing zone|grow zone|planting in\b/.test(blob) ||
        /personali[sz]ation bar/.test(blob) ||
        /\b(location|zip|postcode|postal code)\s*(code)?\s*(bar|field|fields|row|strip|selector|detector|detection|picker|widget)\b/.test(blob);
      return !noop && !praiseOnly && !growZone && !loneWidget;
    });
  return {
    intro: sanitizeDash(o.intro),
    pros: strArray(o.pros, 10),
    findings,
    recommendations: strArray(o.recommendations, 6),
  };
}

/**
 * "Add a sticky add-to-cart bar" on a store that has one.
 *
 * The data section writes plays from order and traffic figures, and it used to
 * receive nothing at all about the storefront, so any play reaching for a page
 * change was guessing. It now gets the probe's measurements, and this is the
 * same rule in code: a step that says to ADD something the capture found on the
 * page is refused outright, whatever the prompt did with the evidence.
 *
 * Keyed by the probe's own feature names, so the two cannot drift apart.
 */
const FEATURE_ADD_CLAIMS: Array<{ feature: string; re: RegExp }> = [
  // The add-verb is required on every one of these. Asking to MOVE or restyle
  // something that is already there is fair advice; only "build this" is the
  // mistake, and an early version of this rule refused both.
  { feature: "sticky_buy_button", re: /\b(add|introduce|install|implement|build|create)\b[^.]{0,40}\b(sticky|floating|fixed)\b[^.]{0,30}\b(add.?to.?cart|add.?to.?bag|buy|atc|checkout)\b[^.]{0,20}\b(bar|button|cta)\b/i },
  { feature: "reviews", re: /\b(add|introduce|install|bring in|start collecting)\b[^.]{0,40}\b(customer )?reviews?\b/i },
  { feature: "recommendations", re: /\b(add|introduce|build)\b[^.]{0,40}\b(product )?(recommendations?|related products?|cross.?sells?|you may also like)\b/i },
  { feature: "newsletter_signup", re: /\b(add|introduce|install)\b[^.]{0,40}\b(email|newsletter)\b[^.]{0,20}\b(signup|sign.?up|capture|form)\b/i },
  { feature: "size_or_fit_guide", re: /\b(add|introduce|build)\b[^.]{0,40}\b(size|fit)\b[^.]{0,15}\b(guide|chart)\b/i },
  { feature: "faq", re: /\b(add|introduce|build)\b[^.]{0,40}\b(faq|frequently asked)\b/i },
];

/** True when this step tells the client to add something they already have. */
export function recommendsExistingFeature(text: unknown, featuresPresent?: Set<string>): boolean {
  if (!featuresPresent || featuresPresent.size === 0) return false;
  const t = String(text ?? "");
  if (!t.trim()) return false;
  for (const { feature, re } of FEATURE_ADD_CLAIMS) {
    if (featuresPresent.has(feature) && re.test(t)) return true;
  }
  return false;
}

const METRIC_KEYS = new Set(["revenue", "orders", "aov", "returning_customer_rate", "top_products", "sales_by_channel"]);

export function coerceAnalytics(
  input: unknown,
  /** Feature keys the capture measured as PRESENT on this storefront, so a step
   *  cannot tell the client to build something they already have. */
  featuresPresent?: Set<string>,
) {
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
  // Plays are the section now; `metrics` stays so audits generated before this
  // change keep rendering their commentary.
  // Same recovery findings already had. A JSON-encoded array read through a
  // bare Array.isArray is an empty section: the whole "Opportunities in the
  // data" block vanished from a live report because this one line was missed
  // when the findings path was fixed.
  const playsRaw = asArray(o.plays);
  const plays = playsRaw
    .map((p) => {
      const rec = (p ?? {}) as Record<string, unknown>;
      // action_steps is the current shape; `action` was the single-sentence
      // version, kept so a play from an earlier audit still shows its work.
      const steps = asArray(rec.action_steps)
        .map((s) => sanitizeDash(s))
        .filter(Boolean)
        .filter((step) => {
          if (isBannedWork(step) || isDiagnosticStep(step) || presumesSetup(step)) return false;
          if (recommendsExistingFeature(step, featuresPresent)) {
            console.warn(JSON.stringify({
              event: "play_step_refused",
              reason: "recommends_a_feature_the_page_already_has",
              step: String(step).slice(0, 140),
            }));
            return false;
          }
          return true;
        })
        .slice(0, 3);
      const legacyAction = sanitizeDash(rec.action);
      return {
        title: sanitizeDash(rec.title),
        insight: sanitizeDash(rec.insight),
        action_steps: steps.length > 0 ? steps : (legacyAction ? [legacyAction] : []),
        products: asArray(rec.products).map((t) => sanitizeDash(t)).filter(Boolean).slice(0, 3),
        metric: sanitizeDash(rec.metric),
        window: sanitizeDash(rec.window),
      };
    })
    // A play with no insight or nothing to do is half an idea and renders as an
    // empty card, so drop it rather than show it.
    .filter((p) => p.title && p.insight && p.action_steps.length > 0)
    .slice(0, 5);
  return { intro: sanitizeDash(o.intro), plays, metrics };
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
  /** Effort in half-hour steps. Setup price is this times the roadmap's rate. */
  setup_hours: number | null;
  setup_cost_label: string;
  ongoing_cost_label: string;
  hidden: boolean;
  investment_included: boolean;
};

/** Snap an estimate to the half hour, inside bounds the schema also enforces. */
function normalizeHours(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(40, Math.max(0.5, Math.round(n * 2) / 2));
}

export function coerceRoadmap(input: unknown, catalog: CatalogRow[]): RoadmapRow[] {
  const o = (input ?? {}) as Record<string, unknown>;
  const rowsRaw = asArray(o.rows);
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
      setup_hours: normalizeHours(rec.setup_hours),
      setup_cost_label: setup,
      ongoing_cost_label: ongoing,
      hidden: false,
      investment_included: true,
    };
  }).filter((r) => r.item_name);
}
