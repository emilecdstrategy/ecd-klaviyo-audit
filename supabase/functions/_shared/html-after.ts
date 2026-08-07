// The HTML "after" engine: build the concept image by EDITING THE REAL PAGE in a
// real browser, instead of asking an image model to repaint a screenshot.
//
// Why this exists. Every recurring after-image complaint had one root cause: a
// generative model redraws every pixel, so the client's own product photos were
// at risk on every single run. Cropped photos, changed aspect ratios, a
// substituted product, an invented garden scene, a phone grid that grew a second
// column (which re-crops every card) are all the same failure wearing different
// clothes, and no number of prompt rules can make full-image regeneration safe.
//
// Here nothing is regenerated. The page loads in Browserless with its own CSS,
// its own web fonts, its own logo and its own photographs; we apply a list of
// DOM/CSS edits and re-screenshot it. So:
//   - photos cannot be re-cropped, reshaped, swapped or invented, because no
//     model ever touches them;
//   - brand colours and fonts cannot drift, because they are never recreated;
//   - injected elements stay on brand by CLONING the theme's own button styles
//     and colour tokens rather than guessing them;
//   - "move this element" is a real DOM move, so it physically cannot leave a
//     duplicate behind, which was its own class of defect;
//   - a phone grid cannot gain columns, because column counts are clamped in code.
//
// The model's only job is choosing WHICH edits to make, from a fixed vocabulary,
// against real selectors from a DOM outline. It never writes code we execute:
// ops are data, interpreted by the fixed runtime below.
//
// RULE PARITY WITH THE IMAGE ERA. Every rule learned from a Gemini failure must
// have an owner on this path too. The ledger, so the next added rule gets one:
//   photos untouched / uncropped / never substituted ... structural (nothing redraws them)
//   phone grid never gains columns .................. setColumns clamp
//   announcement bar stays one line ................. height lock (lockedRegionViolation)
//   cart drawer never taller ........................ height lock
//   cart drawer stays pinned, never a centred modal . drawer horizontal lock
//   moving never duplicates ......................... real DOM move (one node)
//   floating widget moves ........................... offset nudge, not reparenting
//   no second headline / subheadline ................ existingSupportingLine rewrite
//   say it once (no repeated info) .................. add_line duplicate-text check
//   one add control per card ........................ per-card guard
//   no duplicate star rating ........................ per-card guard
//   adding means VISIBLE ............................ offscreen + no-visible-change checks
//   nothing overlaps after an edit .................. collision guard (per-op rollback)
//   nothing grows a row it should not ............... move height check
//   text legible over photos ........................ scrim + white text + shadow
//   stars look like ratings ......................... gold 19px stars, contrast-aware count
//   buttons solid, flat, on-brand ................... cloned from the theme's own button
//   no em dashes in client copy ..................... clean() on every injected string
//   never invent numbers / imagery .................. author rule + honest refusal
//   calm beats complete / first fold light .......... author rules (HTML_AFTER_RULES)
//   nav fits one row ................................ NOT enforceable here yet: the
//     'More' menu rewrite is real information architecture; the author is told to
//     leave it as advice, and the fix reports as not shown rather than faked.
import { createLlmClient, type LlmMessage, type LlmTool } from "./llm-adapter.ts";
import { HTML_AFTER_RULES } from "./ecommerce-ux-kb.ts";
import type { Viewport } from "./after-image-prompt.ts";

export const EDIT_AUTHOR_MODEL = "claude-sonnet-5";

// ---------------------------------------------------------------------------
// 1. The DOM outline probe (read-only, runs on the settled page before edits)
// ---------------------------------------------------------------------------

/** Function body evaluated in the page; returns a compact outline of what is on
 * screen plus the theme's brand tokens. Kept small on purpose: it is prompt
 * input, so every node costs tokens. Selectors are validated for uniqueness in
 * the page before being emitted, so the author writes against selectors that are
 * known to resolve. */
export const DOM_OUTLINE_PROBE = String.raw`
const VW = window.innerWidth;
const VH = window.innerHeight;
const MAXY = VH * 2.2;

// Tailwind-style themes carry classes like "md:list-layout:pt-0" and
// "text-[rgba(var(--x))]", which are not valid in a plain selector. Only keep
// simple, escape-free class names.
function stableClasses(el) {
  return Array.from(el.classList || [])
    .filter((c) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c) && !/^(is|has|js)-/.test(c))
    .slice(0, 3);
}

function selFor(el) {
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    const byId = "#" + el.id;
    try { if (document.querySelectorAll(byId).length === 1) return byId; } catch (e) {}
  }
  let node = el;
  let path = "";
  for (let depth = 0; depth < 4 && node && node.nodeType === 1 && node !== document.body; depth++) {
    const tag = node.tagName.toLowerCase();
    const cls = stableClasses(node);
    let step = tag + (cls.length ? "." + cls.join(".") : "");
    const parent = node.parentElement;
    if (parent) {
      const sameStep = Array.from(parent.children).filter((c) => {
        if (c.tagName.toLowerCase() !== tag) return false;
        const cc = stableClasses(c);
        return cls.every((k) => cc.indexOf(k) !== -1);
      });
      if (sameStep.length > 1) step += ":nth-of-type(" + (Array.prototype.indexOf.call(parent.children, node) + 1) + ")";
    }
    path = path ? step + " > " + path : step;
    try {
      const hits = document.querySelectorAll(path);
      if (hits.length === 1 && hits[0] === el) return path;
    } catch (e) { return null; }
    node = parent;
  }
  try {
    const hits = document.querySelectorAll(path);
    return hits.length > 0 ? path : null;
  } catch (e) { return null; }
}

function roleOf(el) {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "img" || tag === "picture" || tag === "svg") return "image";
  if (tag === "button" || el.getAttribute("role") === "button") return "button";
  if (tag === "input" || tag === "select" || tag === "textarea") return "input";
  if (tag === "nav") return "nav";
  if (tag === "form") return "form";
  const cn = (typeof el.className === "string" ? el.className : "").toLowerCase();
  if (/\bbutton|\bbtn/.test(cn) && (tag === "a" || tag === "div")) return "button";
  if (/price/.test(cn)) return "price";
  if (/announce/.test(cn)) return "announcement";
  if (/card|product-item|grid__item/.test(cn) && el.querySelector("img")) return "product-card";
  const t = (el.innerText || "").trim();
  if (t && t.length < 24 && /^[^a-zA-Z]*[$£€]\s?[\d.,]+/.test(t)) return "price";
  if (tag === "a") return "link";
  return "block";
}

function columnsOf(el) {
  const cs = getComputedStyle(el);
  if (cs.display.indexOf("grid") !== -1) {
    const cols = (cs.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean).length;
    if (cols > 0) return cols;
  }
  // Flex/inline-block rows: count children sharing the first child's top edge.
  const kids = Array.from(el.children).filter((c) => c.getClientRects().length);
  if (kids.length > 1) {
    const top = Math.round(kids[0].getBoundingClientRect().top);
    const inRow = kids.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - top) < 12).length;
    if (inRow > 1) return inRow;
  }
  return null;
}

const out = [];
const seenBox = Object.create(null);
const all = document.body ? document.body.querySelectorAll("*") : [];
for (let i = 0; i < all.length && out.length < 80; i++) {
  const el = all[i];
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript" || tag === "path" || tag === "g") continue;
  const r = el.getBoundingClientRect();
  if (r.width * r.height < 260) continue;
  if (r.top > MAXY || r.bottom < 0) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) continue;

  const text = (el.innerText || "").replace(/\s+/g, " ").trim();
  const imgs = el.querySelectorAll("img").length;
  const role = roleOf(el);
  const ownText = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.replace(/\s+/g, " ").trim())
    .join(" ")
    .trim();
  // Keep nodes that carry their own text, are interactive, are imagery, or are a
  // container of several images (a grid worth describing). Skip pure wrappers.
  const interesting = ownText.length > 0 || role !== "block" || imgs >= 2;
  if (!interesting) continue;

  // Collapse wrapper chains: one node per distinct box.
  const key = Math.round(r.x) + ":" + Math.round(r.y) + ":" + Math.round(r.width) + ":" + Math.round(r.height);
  if (seenBox[key] && role !== "image") continue;
  seenBox[key] = 1;

  const sel = selFor(el);
  if (!sel) continue;
  let n = 1;
  try { n = document.querySelectorAll(sel).length; } catch (e) { n = 1; }

  const node = {
    sel: sel,
    role: role,
    box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
  };
  if (text) node.text = text.slice(0, 90);
  // The unique selector is built with :nth-of-type to pin ONE element, which is
  // the opposite of what a per-card edit needs: given only "grid-item:nth-of-
  // type(1) > ..." the author put a quick add on the first product and none of
  // the other ten. So every repeated element also advertises the generic
  // selector that matches all of its siblings.
  const generic = sel.replace(/:nth-of-type\(\d+\)/g, "");
  if (generic !== sel) {
    let gn = 0;
    try { gn = document.querySelectorAll(generic).length; } catch (e) { gn = 0; }
    if (gn > 1) { node.all = generic; node.allN = gn; }
  }
  if (n > 1) node.n = n;
  if (imgs > 0) node.imgs = imgs;
  const cols = imgs >= 2 || role === "product-card" ? columnsOf(el) : null;
  if (cols && cols > 1) node.cols = cols;
  out.push(node);
}

// Brand tokens, read off the theme itself. Everything injected later is styled
// from these, which is why an added button lands on brand without being guessed.
// The donor is the button every injected control is styled from, so picking the
// wrong one puts the whole "after" off brand. The first version took the largest
// solid button, which on a Klaviyo store is the floating chat launcher: white,
// round and nothing like the theme's buttons, so injected buttons came out white
// on white. Floating widgets and third-party embeds are excluded, and a fill
// identical to the page background loses to one that stands out.
function isFloatingOrThirdParty(el) {
  const VENDOR = /kl-|klaviyo|hub-launcher|intercom|gorgias|tidio|zendesk|drift|crisp|tawk|gladly|attentive|privy|justuno|shopify-chat|back-?to-?top|scroll-?top/i;
  let node = el;
  for (let d = 0; d < 6 && node && node.nodeType === 1; d++) {
    const pos = getComputedStyle(node).position;
    if (pos === "fixed" || pos === "sticky") return true;
    const cn = (typeof node.className === "string" ? node.className : "") + " " + (node.id || "");
    if (VENDOR.test(cn)) return true;
    if (node.tagName === "IFRAME") return true;
    node = node.parentElement;
  }
  return false;
}

function pickDonorButton() {
  const cands = Array.from(document.querySelectorAll(
    "button, a[class*='button'], a[class*='btn'], div[class*='button'], input[type='submit']"
  ));
  const pageBg = getComputedStyle(document.body).backgroundColor;
  let best = null;
  let bestScore = 0;
  for (const c of cands) {
    const r = c.getBoundingClientRect();
    if (r.width < 40 || r.height < 22) continue;
    if (isFloatingOrThirdParty(c)) continue;
    const cs = getComputedStyle(c);
    const bg = cs.backgroundColor;
    if (!bg || bg === "transparent" || /rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) continue;
    const score = r.width * r.height * (bg === pageBg ? 0.05 : 1);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

const donor = pickDonorButton();
const dcs = donor ? getComputedStyle(donor) : null;
const bodyCs = getComputedStyle(document.body);
const h = document.querySelector("h1, h2");
const hcs = h ? getComputedStyle(h) : null;

return {
  viewport: { w: VW, h: VH },
  brand: {
    buttonBg: dcs ? dcs.backgroundColor : null,
    buttonFg: dcs ? dcs.color : null,
    buttonRadius: dcs ? dcs.borderRadius : null,
    buttonFont: dcs ? dcs.fontFamily : null,
    buttonWeight: dcs ? dcs.fontWeight : null,
    buttonPadding: dcs ? dcs.padding : null,
    bodyFont: bodyCs.fontFamily,
    bodyColor: bodyCs.color,
    pageBg: bodyCs.backgroundColor,
    headingFont: hcs ? hcs.fontFamily : null,
    headingColor: hcs ? hcs.color : null,
  },
  nodes: out,
};
`;

export type DomOutline = {
  viewport?: { w: number; h: number };
  brand?: Record<string, string | null>;
  nodes?: Array<Record<string, unknown>>;
  error?: string;
};

export function isUsableOutline(v: unknown): v is DomOutline {
  const o = v as DomOutline | null;
  return Boolean(o && Array.isArray(o.nodes) && o.nodes.length >= 3);
}

// ---------------------------------------------------------------------------
// 2. The edit vocabulary
// ---------------------------------------------------------------------------

export type EditOp = {
  op: string;
  selector?: string;
  target?: string;
  position?: string;
  text?: string;
  style?: string;
  variant?: string;
  items?: string[];
  columns?: number;
  lines?: number;
  stars?: number;
  count?: string;
  props?: Record<string, string>;
  each?: boolean;
  fix_index?: number;
  note?: string;
};

export const EDIT_TOOL: LlmTool = {
  name: "record_page_edits",
  description:
    "Record the list of DOM/CSS edits that turn this real storefront page into the 'after' concept, one or more edits per requested fix.",
  input_schema: {
    type: "object",
    required: ["edits"],
    properties: {
      edits: {
        type: "array",
        description:
          "The edits to apply, in order. Every requested fix must be served by at least one edit. Use ONLY selectors that appear in the supplied page outline.",
        items: {
          type: "object",
          required: ["op", "fix_index"],
          properties: {
            op: {
              type: "string",
              enum: [
                "set_text",
                "add_line",
                "add_button",
                "add_rating",
                "add_badges",
                "hide",
                "move",
                "grid_columns",
                "clamp_lines",
                "emphasize_button",
                "style",
                "rebalance_header",
              ],
              description:
                "set_text: replace an element's copy in place (shortening an announcement bar, rewriting a vague headline). add_line: insert one short line of text. add_button: insert a call-to-action styled from the theme's own button. add_rating: insert a star rating line. add_badges: insert a row of small trust/shipping pills. hide: hide a distracting or duplicate element (never an image). move: physically relocate an element (it cannot leave a copy behind). grid_columns: set how many cards per row. clamp_lines: limit a text block to N lines so the page stays uncrowded. emphasize_button: restyle a weak-looking button as the primary action. style: a small whitelisted CSS tweak (spacing, alignment, width, order). rebalance_header: rebuild the page header into the standard balanced layout (menu and search LEFT, logo CENTER, account and cart RIGHT) using the header's own real elements; use this for ANY finding about a crowded, bunched or unbalanced header, and never try to fix a header with move/style.",
            },
            selector: {
              type: "string",
              description: "CSS selector from the outline naming the element to edit.",
            },
            each: {
              type: "boolean",
              description:
                "true to apply to EVERY element the selector matches (e.g. a quick-add button on every product card). Use with outline nodes that report an 'n' greater than 1.",
            },
            target: { type: "string", description: "For 'move': the selector to move the element next to." },
            position: {
              type: "string",
              enum: ["before", "after", "append", "prepend"],
              description: "Where to place the new or moved element relative to the selector.",
            },
            text: { type: "string", description: "The copy for set_text, add_line or add_button. Keep it short and specific." },
            style: {
              type: "string",
              enum: ["subhead", "benefit", "micro", "trust"],
              description: "Typographic role for add_line: subhead is a supporting line under a heading, benefit is a short value line, micro is small print, trust is a reassurance line.",
            },
            variant: {
              type: "string",
              enum: ["primary", "secondary", "compact", "hero"],
              description: "add_button styling. compact is a small inline control, for a quick add on a card or cart upsell row. hero is the page's single main call-to-action: large, wide and centred; use it when rewriting or adding the hero button.",
            },
            items: {
              type: "array",
              items: { type: "string" },
              description:
                "add_badges: 2 to 4 very short labels. Over a hero photo these render as frosted category pills; use the store's REAL collection or nav names from the outline, never invented categories.",
            },
            columns: { type: "number", description: "grid_columns: cards per row. On a phone this is forced to 1." },
            lines: { type: "number", description: "clamp_lines: how many lines of the text block to keep visible." },
            stars: { type: "number", description: "add_rating: 1 to 5." },
            count: { type: "string", description: "add_rating: the review count text, e.g. '(128)'. Only use a number the page already shows." },
            props: {
              type: "object",
              description:
                "style: CSS property/value pairs. Allowed: margin, margin-top/right/bottom/left, padding and its sides, gap, row-gap, column-gap, max-width, width, text-align, align-items, justify-content, flex-direction, flex-wrap, order, position, top, right, bottom, left, font-size, font-weight, line-height, letter-spacing, border-radius, background, color, box-shadow, z-index, min-height, display. Dimension changes are refused on photos.",
            },
            fix_index: {
              type: "number",
              description: "1-based index of the requested fix this edit serves.",
            },
            note: { type: "string", description: "Very short reason, for the audit trail." },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 3. The runtime that interprets the ops (fixed code, never model-written)
// ---------------------------------------------------------------------------

const EDIT_RUNTIME = String.raw`
const DIMENSION_PROPS = ["width","height","max-width","max-height","min-width","min-height","aspect-ratio","object-fit","transform","scale","zoom"];
const ALLOWED_PROPS = ["margin","margin-top","margin-right","margin-bottom","margin-left","padding","padding-top","padding-right","padding-bottom","padding-left","gap","row-gap","column-gap","max-width","width","text-align","align-items","justify-content","flex-direction","flex-wrap","order","position","top","right","bottom","left","font-size","font-weight","line-height","letter-spacing","border-radius","background","background-color","color","box-shadow","z-index","min-height","display"];
const IMAGE_TAGS = ["IMG","PICTURE","VIDEO","SVG","CANVAS"];

function q(sel) {
  if (!sel || typeof sel !== "string") return [];
  try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
}

function isImageEl(el) {
  return IMAGE_TAGS.indexOf(el.tagName) !== -1;
}

// Excluded from the brand-donor search: a floating chat launcher or a
// third-party embed is not this theme's button, however large it is.
function isFloatingOrThirdParty(el) {
  var VENDOR = /kl-|klaviyo|hub-launcher|intercom|gorgias|tidio|zendesk|drift|crisp|tawk|gladly|attentive|privy|justuno|shopify-chat|back-?to-?top|scroll-?top/i;
  var node = el;
  for (var d = 0; d < 6 && node && node.nodeType === 1; d++) {
    var pos = getComputedStyle(node).position;
    if (pos === "fixed" || pos === "sticky") return true;
    var cn = (typeof node.className === "string" ? node.className : "") + " " + (node.id || "");
    if (VENDOR.test(cn)) return true;
    if (node.tagName === "IFRAME") return true;
    node = node.parentElement;
  }
  return false;
}

function isVisible(el) {
  if (!el.getClientRects().length) return false;
  var cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
}

// The nearest card / row an edit belongs to, used by the duplication guards so
// "one add button per product" is enforced per card rather than per page.
// Walk to the OUTERMOST card wrapper, not the first ancestor that happens to
// have "card" in its class name. Themes nest .card-info inside .card-product
// inside .grid-item, and stopping at .card-info made the guards inconsistent:
// the same "does this card already have a rating" question answered yes or no
// depending on which node inside the card an edit targeted.
function cardOf(el) {
  var node = el;
  var found = null;
  for (var d = 0; d < 6 && node && node.nodeType === 1 && node !== document.body; d++) {
    var cn = (typeof node.className === "string" ? node.className : "").toLowerCase();
    if (/card|product-item|grid__item|grid-item|line-item|cart-item/.test(cn)) found = node;
    node = node.parentElement;
  }
  return found || el.parentElement || el;
}

// ---------------------------------------------------------------------------
// The collision guard. Height and photo checks did not catch the worst homepage
// result: asked to balance a crowded phone header, the author moved the logo and
// the cart icon into different containers and the theme's own positioning put the
// search icon ON TOP of the logo. Nothing was taller and no photo changed, but
// the header was broken.
//
// So every op is applied as a transaction: measure the atomic elements, apply,
// measure again, and if two elements that were apart are now sitting on top of
// each other, undo that op. Multi-element structural rearrangement is simply
// beyond what a list of edits can do reliably, and this is what makes that
// safe instead of hoping the author gets it right.
// ---------------------------------------------------------------------------
function atomicElements() {
  var SEL = "a, button, img, svg, input, select, h1, h2, h3, h4, h5, p, span, li, label";
  var cands = q(SEL).filter(function (el) {
    if (!isVisible(el)) return false;
    // Floating widgets (chat launcher, loyalty badge) sit over page content by
    // design, so they cannot be in the collision watch: nudging one is the fix,
    // and counting its new overlap as a collision reverted that very fix.
    if (isFloatingOrThirdParty(el)) return false;
    var r = el.getBoundingClientRect();
    if (r.width * r.height < 140) return false;
    if (r.top > window.innerHeight * 1.6 || r.bottom < 0) return false;
    return true;
  });
  // Keep only the innermost of any nested pair, so a wrapper is never compared
  // against the thing it wraps.
  var out = [];
  for (var i = 0; i < cands.length && out.length < 150; i++) {
    var el = cands[i];
    var hasInner = false;
    for (var j = 0; j < cands.length; j++) {
      if (cands[j] !== el && el.contains(cands[j])) { hasInner = true; break; }
    }
    if (!hasInner) out.push(el);
  }
  return out;
}

function rectsOf(list) {
  return list.map(function (el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

function overlapKeys(rects) {
  var keys = {};
  for (var i = 0; i < rects.length; i++) {
    for (var j = i + 1; j < rects.length; j++) {
      var a = rects[i], b = rects[j];
      if (a.w < 1 || b.w < 1 || a.h < 1 || b.h < 1) continue;
      var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox <= 1 || oy <= 1) continue;
      var smaller = Math.min(a.w * a.h, b.w * b.h);
      // A third of the smaller element buried under another is a collision, not
      // a design; anything less is normal padding overlap and tolerated.
      if ((ox * oy) / smaller > 0.34) keys[i + "-" + j] = 1;
    }
  }
  return keys;
}

/** Undo one op: remove what it injected, then restore markup, inline styles and
 *  DOM position of everything it touched. */
function undoOp(snapshot, addedBefore) {
  q("[data-ecd-added]").forEach(function (node) {
    if (addedBefore.indexOf(node) === -1 && node.parentElement) node.parentElement.removeChild(node);
  });
  snapshot.forEach(function (s) {
    s.el.innerHTML = s.text;
    if (s.style === null) s.el.removeAttribute("style");
    else s.el.setAttribute("style", s.style);
    if (s.parent && s.el.parentElement !== s.parent) s.parent.insertBefore(s.el, s.next);
  });
}

/** Geometry of the targets and their immediate surroundings. Comparing this
 *  before and after an op is how we tell a real change from a no-op: the header
 *  fix "applied" a move and a style, and the header came back pixel-identical,
 *  yet the report still counted the fix as done. */
function layoutSignature(targets) {
  var parts = [];
  targets.slice(0, 12).forEach(function (el) {
    var r = el.getBoundingClientRect();
    // Geometry AND words: rewriting a subheadline with copy of similar length
    // moves no box at all, and geometry alone called that "renders identically"
    // and voided a perfectly good set_text.
    parts.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","));
    parts.push(((el.textContent || "").replace(/s+/g, " ").trim()).slice(0, 200));
    var parent = el.parentElement;
    if (parent) {
      Array.prototype.slice.call(parent.children).forEach(function (sib) {
        var sr = sib.getBoundingClientRect();
        parts.push([Math.round(sr.x), Math.round(sr.y), Math.round(sr.width), Math.round(sr.height)].join(","));
      });
    }
  });
  return parts.join("|");
}

function newCollisions(list, beforeKeys) {
  var after = overlapKeys(rectsOf(list));
  var found = 0;
  for (var k in after) if (!beforeKeys[k]) found++;
  return found;
}

/** An existing line of supporting copy near this anchor, if there is one, so a
 *  new line rewrites it instead of stacking a second one under it. Searches the
 *  anchor's text block (its nearest multi-child container), not just siblings. */
function existingSupportingLine(anchor, position) {
  var block = anchor.parentElement;
  for (var d = 0; d < 2 && block && block.children.length < 2 && block !== document.body; d++) {
    block = block.parentElement;
  }
  if (!block) return null;
  var heading = /^h[1-6]$/i.test(anchor.tagName) ? anchor : block.querySelector("h1, h2, h3");
  var candidates = Array.prototype.slice.call(block.querySelectorAll("p, div, span"))
    .filter(function (c) {
      if (c === anchor || c.hasAttribute("data-ecd-added")) return false;
      if (!isVisible(c)) return false;
      if (c.querySelector("img, picture, video, svg, button, input, a")) return false;
      if (c.children.length > 0) return false;
      var t = (c.textContent || "").trim();
      // Supporting copy, not a heading, a price, a label or a paragraph of body text.
      if (t.length < 12 || t.length > 240) return false;
      if (heading && (heading.textContent || "").trim() === t) return false;
      if (/^[^a-zA-Z]*[$£€]/.test(t)) return false;
      return true;
    });
  if (candidates.length === 0) return null;
  // Whichever sits nearest the anchor in the direction the new line would go.
  var ar = anchor.getBoundingClientRect();
  candidates.sort(function (a, b) {
    return Math.abs(a.getBoundingClientRect().top - ar.bottom) - Math.abs(b.getBoundingClientRect().top - ar.bottom);
  });
  return position === "before" ? candidates[0] : candidates[candidates.length - 1];
}

/** Product cards inside this element, when it is really a grid or a wrapper
 *  rather than a single card. Empty when the element IS a card. */
function cardsWithin(el) {
  if (el.querySelectorAll("img").length < 2) return [];
  var cards = Array.prototype.slice.call(
    el.querySelectorAll("[class*='card-product'], [class*='grid-item'], [class*='grid__item'], [class*='product-item'], [class*='card-wrapper']"),
  ).filter(function (c) {
    if (!isVisible(c)) return false;
    if (!c.querySelector("img")) return false;
    // Innermost card only, so a wrapper and its card are not both counted.
    return !Array.prototype.slice.call(c.querySelectorAll("[class*='card-product'], [class*='grid-item'], [class*='product-item']")).some(isVisible);
  });
  // If the target is itself one of those cards, this is not a redirect case.
  if (cards.length === 1 && cards[0] === el) return [];
  return cards.slice(0, 30);
}

/** True when this element is a whole section or page wrapper rather than a
 *  specific place to edit. The author keeps aiming text ops at these: a line
 *  added to a section lands wherever the section's own layout puts it (often
 *  overlapping something), and clamping a section's lines does nothing at all. */
function isWrapper(el) {
  var r = el.getBoundingClientRect();
  if (r.height > window.innerHeight * 0.7) return true;
  return el.children.length >= 6 && el.querySelectorAll("img, button, a").length >= 4;
}

/** A sensible element inside a wrapper for the given kind of text edit. */
function refineTextTarget(el, kind) {
  if (!isWrapper(el)) return el;
  if (kind === "clamp") {
    // The longest run of body copy: that is what "keep the description short" means.
    var best = null;
    var bestLen = 120;
    Array.prototype.slice.call(el.querySelectorAll("p, div, span, li")).forEach(function (c) {
      if (c.children.length > 0 || !isVisible(c)) return;
      var len = (c.textContent || "").trim().length;
      if (len > bestLen) { best = c; bestLen = len; }
    });
    return best || el;
  }
  // For an added line: hang it off the heading, or the first visible text leaf.
  var heading = el.querySelector("h1, h2, h3");
  if (heading && isVisible(heading)) return heading;
  var leaf = Array.prototype.slice.call(el.querySelectorAll("p, span, div")).filter(function (c) {
    return c.children.length === 0 && isVisible(c) && (c.textContent || "").trim().length > 12;
  })[0];
  return leaf || el;
}

function photoState() {
  return Array.prototype.slice.call(document.images)
    .map(function (img) {
      var r = img.getBoundingClientRect();
      if (r.width * r.height < 1500) return null;
      return { src: (img.currentSrc || img.src || "").slice(0, 300), ar: r.width / Math.max(1, r.height) };
    })
    .filter(Boolean);
}

// The deterministic photo-integrity check. We never touch photos, so this should
// always come back clean; it is here so "the photos are intact" is a measured
// fact about the actual output rather than an assumption about the code.
function photoDiff(before) {
  var after = photoState();
  var beforeBySrc = {};
  before.forEach(function (p) { beforeBySrc[p.src] = p; });
  var afterBySrc = {};
  after.forEach(function (p) { afterBySrc[p.src] = p; });
  var changed = [];
  before.forEach(function (p) {
    var a = afterBySrc[p.src];
    if (!a) { changed.push("photo disappeared: " + p.src.slice(-60)); return; }
    var drift = Math.abs(a.ar - p.ar) / Math.max(0.01, p.ar);
    if (drift > 0.03) {
      changed.push("photo aspect ratio changed by " + Math.round(drift * 100) + "%: " + p.src.slice(-60));
    }
  });
  after.forEach(function (p) {
    if (!beforeBySrc[p.src]) changed.push("photo appeared that was not in the original: " + p.src.slice(-60));
  });
  return { before: before.length, after: after.length, changed: changed };
}

function brandTokens(hint) {
  var b = hint && typeof hint === "object" ? hint : {};
  var bodyCs = getComputedStyle(document.body);
  var donor = null;
  var cands = q("button, a[class*='button'], a[class*='btn'], input[type='submit']");
  var bestScore = 0;
  for (var i = 0; i < cands.length; i++) {
    var r = cands[i].getBoundingClientRect();
    if (r.width < 40 || r.height < 22) continue;
    if (isFloatingOrThirdParty(cands[i])) continue;
    var cs = getComputedStyle(cands[i]);
    if (!cs.backgroundColor || /rgba\(0,\s*0,\s*0,\s*0\)/.test(cs.backgroundColor) || cs.backgroundColor === "transparent") continue;
    var score = r.width * r.height * (cs.backgroundColor === bodyCs.backgroundColor ? 0.05 : 1);
    if (score > bestScore) { donor = cands[i]; bestScore = score; }
  }
  var d = donor ? getComputedStyle(donor) : null;
  return {
    buttonBg: b.buttonBg || (d ? d.backgroundColor : null) || bodyCs.color,
    buttonFg: b.buttonFg || (d ? d.color : null) || "#ffffff",
    buttonRadius: b.buttonRadius || (d ? d.borderRadius : null) || "6px",
    buttonFont: b.buttonFont || (d ? d.fontFamily : null) || bodyCs.fontFamily,
    buttonWeight: b.buttonWeight || (d ? d.fontWeight : null) || "600",
    bodyFont: b.bodyFont || bodyCs.fontFamily,
    bodyColor: b.bodyColor || bodyCs.color,
    clonedFrom: donor ? (donor.className || donor.tagName) : null,
  };
}

// Which op is currently applying; mark()/tagOp() stamp it onto elements so the
// end-of-run pass can measure one bounding box per op for the report's numbered
// After pins. Measured at the end, not per-op, because later ops shift earlier
// elements.
var CURRENT_OP = -1;
function mark(el) {
  el.setAttribute("data-ecd-added", "1");
  if (CURRENT_OP >= 0) el.setAttribute("data-ecd-op", String(CURRENT_OP));
  return el;
}
function tagOp(el) {
  if (el && CURRENT_OP >= 0) el.setAttribute("data-ecd-op", String(CURRENT_OP));
  return el;
}

// ---------------------------------------------------------------------------
// Contrast. Text sitting over a photograph needs help, and the first version
// gave it none: it copied the neighbouring computed colour and hoped. On the
// LazyLeaf hero that produced a benefit line and a star rating that were barely
// legible over a bright garden photo. So anything we place over imagery gets
// white text, a shadow, and a dark scrim on the photo behind it.
// ---------------------------------------------------------------------------

/** The nearest ancestor that is a photographic backdrop: it either has a
 *  background image, or it contains an image covering most of its own box. */
function backdropOf(el) {
  var node = el;
  for (var d = 0; d < 5 && node && node.nodeType === 1 && node !== document.body; d++) {
    var cs = getComputedStyle(node);
    var r = node.getBoundingClientRect();
    if (r.width > 120 && r.height > 80) {
      if (cs.backgroundImage && cs.backgroundImage !== "none" && cs.backgroundImage.indexOf("url(") !== -1) return node;
      // Media web components (parallax-image, media-hero, slideshow-*) render
      // their photo inside shadow DOM, invisible to querySelectorAll. The tag
      // itself is the tell.
      if (node.tagName.indexOf("-") !== -1 && /image|media|parallax|video|slide|banner/i.test(node.tagName)) return node;
      var media = node.querySelector(":scope > *");
      if (media && media.tagName && media.tagName.indexOf("-") !== -1 &&
        /image|media|parallax|video|slide|banner/i.test(media.tagName)) {
        var mr = media.getBoundingClientRect();
        if (mr.width * mr.height > r.width * r.height * 0.6) return node;
      }
      var imgs = node.querySelectorAll("img, video");
      for (var i = 0; i < imgs.length; i++) {
        var ir = imgs[i].getBoundingClientRect();
        if (ir.width * ir.height > r.width * r.height * 0.6) return node;
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** Put a dark gradient over the photo, once, so text on top of it can be read.
 *  The photograph itself is untouched: this is an overlay, which is what real
 *  storefronts do, and it is what the audit recommends in the first place. */
function ensureScrim(backdrop) {
  if (!backdrop || backdrop.querySelector(":scope > [data-ecd-scrim]")) return false;
  var cs = getComputedStyle(backdrop);
  if (cs.position === "static") backdrop.style.setProperty("position", "relative", "important");
  var scrim = document.createElement("div");
  scrim.setAttribute("data-ecd-scrim", "1");
  scrim.setAttribute("data-ecd-added", "1");
  scrim.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;" +
    "background:linear-gradient(180deg, rgba(0,0,0,.48) 0%, rgba(0,0,0,.36) 45%, rgba(0,0,0,.58) 100%);";
  backdrop.insertBefore(scrim, backdrop.firstChild);
  // Lift the real content above the scrim, or the gradient would cover the very
  // text it exists to make readable.
  Array.prototype.slice.call(backdrop.children).forEach(function (child) {
    if (child === scrim) return;
    var ccs = getComputedStyle(child);
    if (ccs.position === "static") child.style.setProperty("position", "relative", "important");
    child.style.setProperty("z-index", "1", "important");
  });
  return true;
}

/** Everything an injected element needs to know about where it is landing. */
function placementContext(el) {
  var backdrop = backdropOf(el);
  var cs = getComputedStyle(el);
  return {
    onDark: Boolean(backdrop),
    backdrop: backdrop,
    color: cs.color,
    center: cs.textAlign === "center",
  };
}

// House style: no em or en dashes in anything we write into a client's page. The
// author reaches for them constantly ("Loved by our customers — shop the best
// sellers"), so it is enforced here rather than asked for in a prompt.
function clean(text) {
  return String(text == null ? "" : text)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim();
}

function mkLine(text, style, brand, ctx) {
  var el = document.createElement("p");
  var size = style === "micro" ? "12px" : style === "subhead" ? "16px" : "14px";
  var weight = style === "subhead" ? "500" : "400";
  var onDark = ctx && ctx.onDark;
  // Over a photograph, inheriting the neighbour's colour is not enough: pin it
  // to white with a shadow, and rely on the scrim behind it for the rest. Off a
  // photograph, follow the surrounding text.
  var color = onDark ? "#ffffff" : (ctx && ctx.color ? ctx.color : brand.bodyColor);
  el.textContent = clean(text);
  el.style.cssText = "margin:8px 0 0;font-family:" + brand.bodyFont + ";font-size:" + size +
    ";font-weight:" + (onDark ? "500" : weight) + ";line-height:1.45;color:" + color + ";" +
    (onDark ? "text-shadow:0 1px 8px rgba(0,0,0,.6);" : "") +
    (ctx && ctx.center ? "text-align:center;" : "");
  if (style === "micro" && !onDark) el.style.opacity = "0.8";
  return mark(el);
}

/** Bands whose height is fixed by design: the announcement bar and the cart
 *  drawer. An edit may change what they say but never how tall they are, which
 *  is a rule the audit itself applies and the engine kept breaking. */
function heightLockedRegions() {
  var found = [];
  var push = function (el, maxH) {
    if (!el || !isVisible(el)) return;
    var h = el.getBoundingClientRect().height;
    if (h > 0 && h <= maxH && found.indexOf(el) === -1) found.push(el);
  };
  // Announcement bar, by name or by being the thin full-width band at the top.
  q("[class*='announce'], [id*='announce'], [class*='announcement']").forEach(function (el) { push(el, 90); });
  Array.prototype.slice.call(document.body.children).slice(0, 6).forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.top <= 4 && r.width >= window.innerWidth * 0.9) push(el, 72);
  });
  // Cart drawer: it must never grow, or the checkout button leaves the screen.
  q("[class*='cart-drawer'], [class*='drawer'], [class*='mini-cart'], [id*='cart-drawer']").forEach(function (el) {
    if (isVisible(el) && el.getBoundingClientRect().height > 200) {
      if (found.indexOf(el) === -1) found.push(el);
    }
  });
  return found.map(function (el) {
    var r = el.getBoundingClientRect();
    var cn = ((typeof el.className === "string" ? el.className : "") + " " + (el.id || "")).toLowerCase();
    return { el: el, h: r.height, left: r.left, isDrawer: /drawer|mini-cart/.test(cn) };
  });
}

/** A human-readable reason when a locked band was violated, or null. Height is
 *  locked for all of them; the cart drawer also locks its horizontal position,
 *  because "slide cart stays pinned to the right, never a centred modal" was an
 *  image-era rule with no HTML-side guard. */
function lockedRegionViolation(locked) {
  for (var i = 0; i < locked.length; i++) {
    var r = locked[i].el.getBoundingClientRect();
    if (r.height - locked[i].h > 2) {
      return "made a fixed-height band (announcement bar or cart drawer) " + Math.round(r.height - locked[i].h) + "px taller";
    }
    if (locked[i].isDrawer && Math.abs(r.left - locked[i].left) > 8) {
      return "moved the cart drawer " + Math.round(Math.abs(r.left - locked[i].left)) + "px sideways; it stays pinned where it is";
    }
  }
  return null;
}

/** True when this element lives inside a thin band, where a full-width block
 *  button would force the band onto a second line. */
function inThinBand(el) {
  var node = el;
  for (var d = 0; d < 5 && node && node.nodeType === 1 && node !== document.body; d++) {
    var r = node.getBoundingClientRect();
    if (r.width >= window.innerWidth * 0.8 && r.height > 0 && r.height <= 72) return true;
    node = node.parentElement;
  }
  return false;
}

function mkButton(text, variant, brand) {
  var el = document.createElement("button");
  el.textContent = clean(text);
  // An announcement bar asked for "a short link like Shop now inside the bar"
  // and got a full-width block button, which doubled the bar's height. In a thin
  // band the right control is an inline link on the line that is already there.
  if (variant === "inline") {
    el.style.cssText = "display:inline;background:none;border:0;padding:0;margin:0 0 0 10px;cursor:pointer;" +
      "font:inherit;color:inherit;text-decoration:underline;text-underline-offset:2px;font-weight:700;";
    return mark(el);
  }
  if (variant === "hero") {
    // The page's one main call-to-action: large, wide, centred, unmissable. A
    // hero whose button looks like every other button is why the afters read
    // as unchanged.
    el.style.cssText = "display:block;box-sizing:border-box;border:0;cursor:pointer;margin:16px auto 0;" +
      "min-width:min(320px, 86%);padding:15px 34px;font-size:15px;letter-spacing:.08em;text-transform:uppercase;" +
      "font-family:" + brand.buttonFont + ";font-weight:" + brand.buttonWeight + ";border-radius:" + brand.buttonRadius +
      ";background:" + brand.buttonBg + ";color:" + brand.buttonFg + ";box-shadow:0 6px 18px rgba(0,0,0,.25);";
    return mark(el);
  }
  var compact = variant === "compact";
  var base = "display:block;box-sizing:border-box;border:0;cursor:pointer;font-family:" + brand.buttonFont +
    ";font-weight:" + brand.buttonWeight + ";border-radius:" + brand.buttonRadius + ";";
  if (variant === "secondary") {
    base += "background:transparent;color:" + brand.buttonBg + ";box-shadow:inset 0 0 0 1.5px " + brand.buttonBg + ";";
  } else {
    base += "background:" + brand.buttonBg + ";color:" + brand.buttonFg + ";";
  }
  base += compact
    ? "width:100%;margin-top:8px;padding:8px 10px;font-size:13px;"
    : "width:100%;margin-top:12px;padding:12px 16px;font-size:15px;";
  el.style.cssText = base;
  return mark(el);
}

function mkRating(stars, count, brand, ctx) {
  var n = Math.max(1, Math.min(5, Math.round(Number(stars) || 5)));
  var el = document.createElement("div");
  var filled = "";
  for (var i = 0; i < 5; i++) filled += i < n ? "★" : "☆";
  var starSpan = document.createElement("span");
  starSpan.textContent = filled;
  // Review stars are GOLD, not the brand colour, and they have to be big enough
  // to read. Tinting them with the theme's button green produced a row of tiny
  // green marks nobody recognised as a rating: gold is the convention shoppers
  // read instantly, on every storefront.
  var onDark = ctx && ctx.onDark;
  starSpan.style.cssText = "letter-spacing:2px;color:#f5a524;font-size:19px;line-height:1;" +
    (onDark ? "text-shadow:0 1px 6px rgba(0,0,0,.55);" : "");
  el.appendChild(starSpan);
  if (count) {
    var c = document.createElement("span");
    c.textContent = " " + clean(count);
    // The count sits next to the stars, so it needs the same contrast treatment
    // as any other text we add: it was rendering near-invisible over a photo.
    c.style.cssText = "font-family:" + brand.bodyFont + ";font-size:14px;font-weight:600;color:" +
      (onDark ? "#ffffff" : brand.bodyColor) + ";" +
      (onDark ? "text-shadow:0 1px 3px rgba(0,0,0,.9), 0 0 12px rgba(0,0,0,.5);" : "opacity:.85;");
    el.appendChild(c);
  }
  el.style.cssText = "display:flex;align-items:center;gap:6px;margin:10px 0 0;" +
    (ctx && ctx.center ? "justify-content:center;" : "");
  return mark(el);
}

function mkBadges(items, brand, ctx) {
  var onDark = ctx && ctx.onDark;
  var wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;" +
    (ctx && ctx.center ? "justify-content:center;" : "");
  (items || []).slice(0, 4).forEach(function (t) {
    var pill = document.createElement("span");
    pill.textContent = clean(t);
    // Over a hero photo the pills go frosted white, which is how real
    // storefronts put category shortcuts on imagery.
    pill.style.cssText = onDark
      ? "font-family:" + brand.bodyFont + ";font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;" +
        "line-height:1;padding:8px 14px;border-radius:999px;color:#ffffff;background:rgba(255,255,255,.16);" +
        "box-shadow:inset 0 0 0 1px rgba(255,255,255,.55);backdrop-filter:blur(2px);white-space:nowrap;"
      : "font-family:" + brand.bodyFont + ";font-size:12px;line-height:1;padding:7px 10px;border-radius:999px;" +
        "color:" + brand.bodyColor + ";box-shadow:inset 0 0 0 1px rgba(128,128,128,.35);white-space:nowrap;";
    wrap.appendChild(pill);
  });
  return mark(wrap);
}

function place(node, anchor, position) {
  var pos = position || "after";
  if (pos === "before") anchor.parentElement.insertBefore(node, anchor);
  else if (pos === "prepend") anchor.insertBefore(node, anchor.firstChild);
  else if (pos === "append") anchor.appendChild(node);
  else anchor.parentElement.insertBefore(node, anchor.nextSibling);
  return node;
}

function applyStyle(el, props, result) {
  var containsImage = isImageEl(el) || el.querySelector("img, picture, video, svg");
  Object.keys(props || {}).forEach(function (rawKey) {
    var key = String(rawKey).toLowerCase().trim();
    var val = String(props[rawKey]);
    if (ALLOWED_PROPS.indexOf(key) === -1) { result.skipped.push(key + " (not allowed)"); return; }
    if (/url\(|expression|javascript:/i.test(val)) { result.skipped.push(key + " (unsafe value)"); return; }
    // The structural photo guard: never let a style op resize or reframe
    // anything that is, or contains, a photograph.
    if (containsImage && DIMENSION_PROPS.indexOf(key) !== -1) { result.skipped.push(key + " (would resize a photo)"); return; }
    el.style.setProperty(key, val, "important");
  });
}

function setColumns(el, columns, isMobile, result) {
  // A phone grid never gains columns: narrowing cards is exactly what re-crops
  // every product photo, so the count is clamped here rather than requested in
  // a prompt.
  var n = Math.max(1, Math.round(Number(columns) || 1));
  if (isMobile && n > 1) { result.skipped.push("columns clamped to 1 on mobile (asked for " + n + ")"); n = 1; }
  var cs = getComputedStyle(el);
  if (cs.display.indexOf("grid") !== -1) {
    el.style.setProperty("grid-template-columns", "repeat(" + n + ", minmax(0, 1fr))", "important");
    return true;
  }
  if (cs.display.indexOf("flex") !== -1) {
    el.style.setProperty("flex-wrap", "wrap", "important");
    Array.prototype.slice.call(el.children).forEach(function (c) {
      c.style.setProperty("flex", "0 0 calc(" + (100 / n) + "% - 12px)", "important");
      c.style.setProperty("max-width", "calc(" + (100 / n) + "% - 12px)", "important");
    });
    return true;
  }
  el.style.setProperty("display", "grid", "important");
  el.style.setProperty("grid-template-columns", "repeat(" + n + ", minmax(0, 1fr))", "important");
  el.style.setProperty("gap", "16px", "important");
  return true;
}

function applyOp(op, brand, opts) {
  var result = { op: op.op, selector: op.selector || null, fix_index: op.fix_index || null, matched: 0, applied: false, skipped: [] };
  var targets = q(op.selector);
  result.matched = targets.length;
  if (targets.length === 0) { result.error = "selector matched nothing"; return result; }
  // Themes with a hidden list-layout variant expose two nodes per product, so an
  // "each" op matched 22 elements on an 11-product grid and half the work landed
  // on invisible copies. Only edit what is actually on screen.
  var visible = targets.filter(isVisible);
  if (visible.length === 0) { result.error = "selector matched only hidden elements"; return result; }
  result.matched = visible.length;
  var list = op.each ? visible.slice(0, 30) : [visible[0]];

  list.forEach(function (el) {
    switch (op.op) {
      case "set_text": {
        if (!op.text) { result.skipped.push("no text"); return; }
        // Rewrite the deepest text-bearing node so the theme's own typography
        // and inline markup survive the change.
        var host = el;
        while (host.children.length === 1 && (host.textContent || "").trim() === (host.children[0].textContent || "").trim()) {
          host = host.children[0];
        }
        host.textContent = clean(op.text);
        tagOp(host);
        // Rewriting a hero headline puts new words over the same photo, so give
        // it the same readability treatment as anything we inject.
        var textBackdrop = backdropOf(host);
        if (textBackdrop) ensureScrim(textBackdrop);
        result.applied = true;
        break;
      }
      case "add_line": {
        if (!op.text) { result.skipped.push("no text"); return; }
        var refined = refineTextTarget(el, "line");
        if (refined !== el) {
          result.skipped.push("aimed at a section wrapper; anchored to the heading or first line inside it");
          el = refined;
        }
        // Say it once: never add a line the page (or an earlier edit) already says.
        var norm = String(op.text).toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (norm.length > 8 && (document.body.innerText || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").indexOf(norm) !== -1) {
          result.skipped.push("this line already appears on the page");
          return;
        }
        // NEVER STACK A SECOND SUBHEADLINE. Checking only the immediate sibling
        // was not enough: on a later run the anchor was a different node, the
        // sibling test missed, and the hero came back with "Premium plants, tools
        // and supplies" stacked under the store's own subhead. The whole text
        // block around the anchor is searched now.
        var pos = op.position || "after";
        // The rewrite-instead-of-stack path exists for the HERO subheadline, the
        // one place a second line reads as a duplicate. Anchored to a product
        // title it rewrote real copy (a vendor line, a variant label) when the
        // fix only asked to add a trust line. So: a heading anchor, and either an
        // explicit subhead, or a heading sitting over hero imagery.
        var lineHeading = /^h[1-6]$/i.test(el.tagName);
        var heroish = lineHeading && (op.style === "subhead" || Boolean(backdropOf(el)));
        var existing = heroish ? existingSupportingLine(el, pos) : null;
        if (existing) {
          existing.textContent = clean(op.text);
          // Marked as rewritten, NOT as added: data-ecd-added means "a node we
          // injected", and using it here made the off-screen check treat an
          // existing element as a fresh injection and void a good edit.
          existing.setAttribute("data-ecd-rewritten", "1");
          var exCtx = placementContext(existing);
          if (exCtx.backdrop) ensureScrim(exCtx.backdrop);
          result.skipped.push("rewrote the existing supporting line instead of adding a second one");
          result.applied = true;
          break;
        }
        var lineCtx = placementContext(el);
        if (lineCtx.backdrop) ensureScrim(lineCtx.backdrop);
        var cs = getComputedStyle(el);
        var line = mkLine(op.text, op.style || "benefit", brand, lineCtx);
        // A HEADING'S SUPPORTING LINE GOES INSIDE THE HEADING. Hero titles are
        // usually absolutely positioned and centred inside a banner, so a sibling
        // <p> "after" the title lands wherever the banner's own layout puts it:
        // on desktop the line ended up in the banner's bottom-left corner instead
        // of under the words. Riding inside the heading inherits its position and
        // alignment on every viewport.
        if (/^h[1-6]$/i.test(el.tagName) && pos === "after") {
          line.style.setProperty("text-align", cs.textAlign, "important");
          line.style.setProperty("letter-spacing", "normal", "important");
          el.appendChild(line);
          result.applied = true;
          break;
        }
        place(line, el, pos);
        result.applied = true;
        break;
      }
      case "add_button": {
        if (!op.text) { result.skipped.push("no text"); return; }
        // A quick add aimed at a GRID or page wrapper lands once, at the bottom
        // of the section, nowhere near a product. Telling the author not to do it
        // did not stop it, so the runtime repairs it: put the control on each card
        // inside the container it was pointed at.
        var cardsInside = cardsWithin(el);
        if (cardsInside.length > 1) {
          cardsInside.forEach(function (card) {
            if (card.querySelector("button[data-ecd-added]")) return;
            var slot = card.querySelector("[class*='card-info'], [class*='card-content'], [class*='caption']") || card;
            place(mkButton(op.text, "compact", brand), slot, "append");
          });
          result.skipped.push("redirected onto the " + cardsInside.length + " cards inside the container");
          result.applied = true;
          break;
        }
        // ONE ADD CONTROL PER CARD. Two fixes often both ask for a quick add on
        // the collection grid ("put a quick add on the card" and "add an Add to
        // cart button"), which put two buttons on the same product. The guard is
        // per card rather than per page, so each card still gets exactly one.
        var card = cardOf(el);
        if (card.querySelector("button[data-ecd-added]")) {
          result.skipped.push("an add control was already added to this card");
          return;
        }
        // A thin band (an announcement bar) can only take an inline link; a block
        // button there is what turned a one-line bar into two.
        var btnVariant = inThinBand(el) ? "inline" : (op.variant || "primary");
        if (btnVariant === "inline") result.skipped.push("used an inline link: the target is a thin band");
        place(mkButton(op.text, btnVariant, brand), el, op.position || "append");
        result.applied = true;
        break;
      }
      case "add_rating": {
        // Never add a rating next to a rating the page already shows: that is a
        // duplicate, and it also means inventing a number the store did not give
        // us. Real ratings are common on collection cards, so this fires often.
        var ratingHost = cardOf(el);
        var existing = ratingHost.querySelector("[class*='rating'], [class*='stars'], [class*='review'], .jdgm-widget, .spr-badge");
        if ((existing && isVisible(existing)) || /[★⭐]/.test(ratingHost.textContent || "")) {
          result.skipped.push("this card already shows a rating");
          return;
        }
        var ratingCtx = placementContext(el);
        if (ratingCtx.backdrop) ensureScrim(ratingCtx.backdrop);
        place(mkRating(op.stars, op.count, brand, ratingCtx), el, op.position || "after");
        result.applied = true;
        break;
      }
      case "add_badges": {
        if (!op.items || !op.items.length) { result.skipped.push("no items"); return; }
        var badgeCtx = placementContext(el);
        if (badgeCtx.backdrop) ensureScrim(badgeCtx.backdrop);
        var badgeAnchor = el;
        if (badgeCtx.backdrop) {
          // The heading usually lives in a SIBLING overlay of the image wrapper,
          // not inside it, so walk up from the backdrop until a scope holds a
          // visible heading. Anchoring there puts the pills on the overlay
          // (above the photo) instead of inside the background layer.
          // "Heading" by size, not by tag: this theme's hero headline is a
          // styled <p>, so an h1-h3 query found nothing and the rescue never
          // fired. The biggest visible text in the hero IS the headline.
          var heroScope = badgeCtx.backdrop;
          var heroHeading = null;
          for (var hd = 0; hd < 3 && heroScope && heroScope !== document.body; hd++) {
            var biggest = null;
            var biggestSize = 19;
            Array.prototype.slice.call(heroScope.querySelectorAll("h1, h2, h3, p, div, span")).forEach(function (cand) {
              if (!isVisible(cand)) return;
              var own = Array.prototype.slice.call(cand.childNodes)
                .filter(function (n) { return n.nodeType === 3; })
                .map(function (n) { return (n.textContent || "").trim(); })
                .join("");
              if (own.length < 4) return;
              var size = parseFloat(getComputedStyle(cand).fontSize) || 0;
              if (size > biggestSize) { biggest = cand; biggestSize = size; }
            });
            if (biggest) { heroHeading = biggest; break; }
            heroScope = heroScope.parentElement;
          }
          if (heroHeading && !el.contains(heroHeading) && !heroHeading.contains(el)) {
            badgeAnchor = heroHeading;
            result.skipped.push("anchored to the hero heading so the pills sit on the overlay, not the background");
          }
        }
        var badgeRow = mkBadges(op.items, brand, badgeCtx);
        badgeRow.style.setProperty("position", "relative", "important");
        badgeRow.style.setProperty("z-index", "3", "important");
        // Hero overlays are commonly pointer-events:none, which makes
        // elementFromPoint skip everything in them, including pills that are
        // plainly visible, and the occlusion probe then removes a good row.
        // Making the row hit-testable keeps the probe honest.
        badgeRow.style.setProperty("pointer-events", "auto", "important");
        place(badgeRow, badgeAnchor, badgeAnchor === el ? (op.position || "after") : "after");
        // Occlusion check: a box measurement cannot tell that something else is
        // painted ON TOP. Probe the centre of the first pill; if the hit is not
        // the pill row, the pills are behind the hero image and must not count.
        var probeRow = function () {
          var fp = badgeRow.firstElementChild;
          if (!fp) return true;
          var fr = fp.getBoundingClientRect();
          if (fr.width < 2 || fr.height < 2) return false;
          var h = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2);
          return Boolean(h && (badgeRow.contains(h) || h.contains(badgeRow)));
        };
        if (!probeRow()) {
          // Second try: widen scope one ancestor at a time until it holds a
          // headline. Stopping at "big enough box" landed on the media element
          // itself, whose light DOM has no text at all: the overlay copy lives
          // in a SIBLING subtree, only reachable from a shared ancestor.
          var headline = null;
          var scope = el.parentElement;
          for (var sd = 0; sd < 7 && scope && scope !== document.body && !headline; sd++) {
            var headlineSize = 19;
            Array.prototype.slice.call(scope.querySelectorAll("h1, h2, h3, p, div, span")).forEach(function (cand) {
              if (!isVisible(cand) || cand.hasAttribute("data-ecd-added") || badgeRow.contains(cand)) return;
              var own = Array.prototype.slice.call(cand.childNodes)
                .filter(function (n) { return n.nodeType === 3; })
                .map(function (n) { return (n.textContent || "").trim(); })
                .join("");
              if (own.length < 4) return;
              var size = parseFloat(getComputedStyle(cand).fontSize) || 0;
              if (size > headlineSize) { headline = cand; headlineSize = size; }
            });
            scope = scope.parentElement;
          }
          if (headline) {
            place(badgeRow, headline, "after");
            result.skipped.push("re-anchored under the hero headline: the first spot was a background layer");
          }
        }
        var firstPill = badgeRow.firstElementChild;
        if (firstPill) {
          var pr = firstPill.getBoundingClientRect();
          var hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
          var related = hit && (badgeRow.contains(hit) || hit.contains(badgeRow));
          if (!related) {
            // Name what was actually on top, so a wrong removal is debuggable
            // from the report instead of by guesswork.
            var hitDesc = hit
              ? hit.tagName + "." + String(typeof hit.className === "string" ? hit.className : "").split(/s+/).slice(0, 2).join(".")
              : "null";
            var pillRect = firstPill.getBoundingClientRect();
            if (badgeRow.parentElement) badgeRow.parentElement.removeChild(badgeRow);
            result.skipped.push(
              "removed: pills occluded (probe hit " + hitDesc + " at " + Math.round(pillRect.left) + "," + Math.round(pillRect.top) +
              " size " + Math.round(pillRect.width) + "x" + Math.round(pillRect.height) + ")",
            );
            return;
          }
        }
        result.applied = true;
        break;
      }
      case "hide": {
        // Hiding a photograph is photo damage by another name.
        if (isImageEl(el) || (el.querySelector("img") && el.getBoundingClientRect().height > 120)) {
          result.skipped.push("refused to hide imagery");
          return;
        }
        el.style.setProperty("display", "none", "important");
        result.applied = true;
        break;
      }
      case "move": {
        // A FLOATING WIDGET IS NOT MOVED BY REPARENTING IT. A chat launcher is
        // position:fixed, so moving its node in the DOM leaves it exactly where it
        // was on screen: the edit "succeeds" and the overlap it was meant to fix is
        // still there. What actually moves it is its offset, so nudge it clear of
        // whatever it is covering.
        // The FIXED element is often an ancestor wrapper, not the button the
        // author selected: checking only the element's own position sent a
        // static button inside a fixed chat container down the DOM-move path,
        // where the height guard rightly reverted it. Find the fixed root and
        // nudge THAT.
        var fixedRoot = null;
        var walkF = el;
        for (var fdw = 0; fdw < 6 && walkF && walkF.nodeType === 1 && walkF !== document.body; fdw++) {
          var posW = getComputedStyle(walkF).position;
          if (posW === "fixed" || posW === "sticky") fixedRoot = walkF;
          walkF = walkF.parentElement;
        }
        if (fixedRoot) {
          var rNow = fixedRoot.getBoundingClientRect();
          var bottomNow = window.innerHeight - rNow.bottom;
          fixedRoot.style.setProperty("bottom", Math.round(bottomNow + 96) + "px", "important");
          fixedRoot.style.setProperty("top", "auto", "important");
          tagOp(fixedRoot);
          result.skipped.push("floating widget nudged clear instead of reparented");
          result.applied = true;
          break;
        }
        var anchors = q(op.target);
        if (anchors.length === 0) { result.error = "move target matched nothing"; return; }
        // A real DOM move. There is exactly one node, so it physically cannot
        // leave a duplicate behind, which is what the image model always did.
        //
        // A MOVE MUST NOT MAKE ANYTHING TALLER. Asked to balance a phone header,
        // the author moved the search icon out of the icon row and onto a line of
        // its own under the logo: a second header row that pushed the hero down
        // the screen, which is worse than the crowding it was fixing. So the move
        // is measured, and put back if it cost vertical space.
        var oldParent = el.parentElement;
        var oldNext = el.nextSibling;
        var host = anchors[0].parentElement || anchors[0];
        var heightBefore = host.getBoundingClientRect().height;
        place(el, anchors[0], op.position || "after");
        tagOp(el);
        var grew = host.getBoundingClientRect().height - heightBefore;
        if (grew > 8 && oldParent) {
          oldParent.insertBefore(el, oldNext);
          result.skipped.push("move reverted: it made its new row " + Math.round(grew) + "px taller");
          return;
        }
        result.applied = true;
        break;
      }
      case "grid_columns": {
        tagOp(el);
        result.applied = setColumns(el, op.columns, opts.isMobile, result);
        break;
      }
      case "clamp_lines": {
        var clampTarget = refineTextTarget(el, "clamp");
        if (clampTarget !== el) {
          result.skipped.push("aimed at a section wrapper; clamped the longest text block inside it");
          el = clampTarget;
        }
        var lines = Math.max(1, Math.round(Number(op.lines) || 3));
        el.style.setProperty("display", "-webkit-box", "important");
        el.style.setProperty("-webkit-line-clamp", String(lines), "important");
        el.style.setProperty("-webkit-box-orient", "vertical", "important");
        el.style.setProperty("overflow", "hidden", "important");
        tagOp(el);
        result.applied = true;
        break;
      }
      case "emphasize_button": {
        el.style.setProperty("background", brand.buttonBg, "important");
        el.style.setProperty("color", brand.buttonFg, "important");
        el.style.setProperty("border-radius", brand.buttonRadius, "important");
        el.style.setProperty("box-shadow", "none", "important");
        tagOp(el);
        result.applied = true;
        break;
      }
      case "style": {
        applyStyle(el, op.props, result);
        tagOp(el);
        result.applied = true;
        break;
      }
      case "rebalance_header": {
        // Rebuild the header into the standard balanced layout using its OWN
        // real elements: menu and search on the left, the logo centred, the
        // cart on the right. Freeform moves and styles kept either doing
        // nothing (theme CSS overrode them) or colliding icons into the logo;
        // a rebuild into one fresh flex row is deterministic. Height is locked,
        // every element is the theme's own node moved once, nothing is redrawn.
        var headerEl = el.closest("header") || (el.tagName === "HEADER" ? el : el.querySelector("header")) || el;
        // The first match is often a HIDDEN image (a mega-menu thumbnail), which
        // is how this op reported "no logo" on a header that plainly has one.
        // Gather candidates and take the first VISIBLE, plausibly logo-sized one,
        // preferring things actually named logo over any old linked image.
        var logoImg = Array.prototype.slice.call(
          headerEl.querySelectorAll("[class*='logo'] img, img[class*='logo'], [class*='logo'] svg, [class*='logo'], a[href='/'] img, a img, a svg"),
        ).filter(function (cand) {
          if (!isVisible(cand)) return false;
          var r = cand.getBoundingClientRect();
          return r.width >= 40 && r.width <= 420 && r.height >= 12 && r.height <= 130;
        }).sort(function (a, b) {
          var score = function (x) {
            var cn = ((typeof x.className === "string" ? x.className : "") + " " +
              ((x.parentElement && typeof x.parentElement.className === "string") ? x.parentElement.className : "")).toLowerCase();
            return /logo/.test(cn) ? 0 : 1;
          };
          return score(a) - score(b);
        })[0];
        if (!logoImg) { result.error = "no logo found in the header"; return; }
        var logoRoot = logoImg.closest("a") || logoImg;
        // The row that actually holds the logo, not the whole <header>, which
        // often also contains the announcement bar or a search band.
        var row = logoRoot.parentElement;
        var headerBox = headerEl.getBoundingClientRect();
        for (var d = 0; d < 4 && row && row.parentElement && row !== headerEl; d++) {
          var rr = row.getBoundingClientRect();
          if (rr.width >= headerBox.width * 0.8 && rr.height <= 140) break;
          row = row.parentElement;
        }
        if (!row || row === document.body) { result.error = "no header row found"; return; }
        var rowBox = row.getBoundingClientRect();

        // The controls: small interactive elements in the row, classified by
        // what they link to or say. Everything is detected, nothing invented.
        // The whole header, not just the logo's row: themes often put the
        // hamburger in a sibling wrapper, and searching only the row silently
        // DROPPED it from the rebuilt header, which deletes an icon instead of
        // repositioning it.
        // Not just a/button: theme drawer toggles are labels, aria-wired divs or
        // custom elements, and missing one DELETES an icon from the rebuilt
        // header. The size filter keeps this from swallowing whole nav menus.
        var controls = Array.prototype.slice.call(headerEl.querySelectorAll(
          "a, button, summary, label, [role='button'], [aria-controls], [aria-expanded], [class*='burger'], [class*='menu-toggle'], [class*='menu-icon'], [class*='hamburger']",
        ))
          .filter(function (c) {
            if (!isVisible(c) || c === logoRoot || logoRoot.contains(c) || c.contains(logoRoot)) return false;
            var r = c.getBoundingClientRect();
            if (r.width > 90 || r.height > 90 || r.width < 8 || r.height < 8) return false;
            return !Array.prototype.slice.call(
              c.querySelectorAll("a, button, summary, label, [role='button'], [aria-controls]"),
            ).some(isVisible);
          })
          // An aria-wired wrapper and its inner button both match; innermost
          // filtering handles nesting, this dedupes exact duplicates.
          .filter(function (c, i, arr) { return arr.indexOf(c) === i; });
        if (controls.length === 0) { result.error = "no header controls found"; return; }
        var kindOf = function (c) {
          var sig = ((c.getAttribute("href") || "") + " " + (typeof c.className === "string" ? c.className : "") + " " +
            (c.getAttribute("aria-label") || "") + " " + (c.getAttribute("id") || "") + " " + (c.textContent || "")).toLowerCase();
          if (/cart|bag|basket/.test(sig)) return "cart";
          if (/search/.test(sig)) return "search";
          if (/account|login|customer|profile|user/.test(sig)) return "account";
          if (/menu|burger|drawer|nav/.test(sig) || c.tagName === "SUMMARY") return "menu";
          return "other";
        };
        // Geometric sweep for what the selector query cannot see: a web
        // component hamburger keeps its icon in shadow DOM and matches nothing,
        // and the rebuild then DELETES it from the header. Anything icon-sized
        // sitting in the header row that is not already a known piece is a
        // control, whatever its tag is.
        var known = controls.concat([logoRoot]);
        var extras = Array.prototype.slice.call(headerEl.querySelectorAll("*")).filter(function (x) {
          if (!isVisible(x)) return false;
          if (known.some(function (k) { return k === x || k.contains(x) || x.contains(k); })) return false;
          var xr = x.getBoundingClientRect();
          if (xr.width < 16 || xr.width > 90 || xr.height < 16 || xr.height > 90) return false;
          if (xr.top < rowBox.top - 6 || xr.bottom > rowBox.bottom + 6) return false;
          return true;
        });
        extras = extras.filter(function (x) {
          return !extras.some(function (o) { return o !== x && o.contains(x); });
        });
        controls = controls.concat(extras);

        var groups = { menu: [], search: [], account: [], cart: [], other: [] };
        controls.forEach(function (c) { groups[kindOf(c)].push(c); });
        // The rebuilt header is only as good as this detection, so record it:
        // a header that came back missing its hamburger was undebuggable without
        // knowing which pieces the op saw.
        result.skipped.push(
          "pieces: menu=" + groups.menu.length + " search=" + groups.search.length +
          " account=" + groups.account.length + " cart=" + groups.cart.length + " other=" + groups.other.length,
        );

        // One fresh flex row; the real nodes are MOVED into it exactly once.
        var mk = function () {
          var g = document.createElement("div");
          g.style.cssText = "display:flex;align-items:center;gap:16px;flex:1 1 0;min-width:0;";
          return g;
        };
        // A moved control drags its old layout with it: margin-left:auto pushed
        // the search icon across its new group and up against the logo. Strip
        // everything positional; the flex groups own the layout now.
        var normCtl = function (c) {
          c.style.setProperty("margin", "0", "important");
          c.style.setProperty("float", "none", "important");
          c.style.setProperty("position", "static", "important");
          c.style.setProperty("flex", "0 0 auto", "important");
          return c;
        };
        var left = mk(); var centre = mk(); var right = mk();
        centre.style.justifyContent = "center";
        centre.style.flex = "0 0 auto";
        right.style.justifyContent = "flex-end";
        groups.menu.forEach(function (c) { left.appendChild(normCtl(c)); });
        groups.search.forEach(function (c) { left.appendChild(normCtl(c)); });
        groups.other.forEach(function (c) { left.appendChild(normCtl(c)); });
        centre.appendChild(normCtl(logoRoot));
        groups.account.forEach(function (c) { right.appendChild(normCtl(c)); });
        groups.cart.forEach(function (c) { right.appendChild(normCtl(c)); });

        // Whatever else the row held is hidden, not deleted: usually the
        // now-empty wrappers the theme used for its own layout.
        Array.prototype.slice.call(row.children).forEach(function (child) {
          child.style.setProperty("display", "none", "important");
        });
        row.appendChild(left); row.appendChild(centre); row.appendChild(right);
        row.style.setProperty("display", "flex", "important");
        row.style.setProperty("align-items", "center", "important");
        row.style.setProperty("height", Math.round(rowBox.height) + "px", "important");
        row.style.setProperty("padding", "0 14px", "important");
        tagOp(row);

        // The op's own acceptance checks, stricter than the generic guards:
        // same height, one line, logo still visible, nothing overlapping inside.
        var newBox = row.getBoundingClientRect();
        var pieces = [logoRoot].concat(controls).filter(isVisible);
        var tops = pieces.map(function (x) { return x.getBoundingClientRect().top; });
        var oneRow = Math.max.apply(null, tops) - Math.min.apply(null, tops) < 18;
        var innerOverlap = overlapKeys(rectsOf(pieces));
        // Balancing means repositioning, never deleting: every control that was
        // visible before must still be visible after, or the rebuild is refused.
        var allSurvived = controls.every(isVisible);
        var ok = Math.abs(newBox.height - rowBox.height) <= 6 && oneRow && allSurvived &&
          isVisible(logoImg) && Object.keys(innerOverlap).length === 0;
        if (!ok) { result.error = "rebuilt header failed its own checks"; return; }
        result.applied = true;
        break;
      }
      default:
        result.error = "unknown op";
    }
  });
  return result;
}

/** Apply one op inside a transaction: snapshot enough to undo it, apply it, and
 * roll it back if it made existing elements collide. */
function applyOpGuarded(op, brand, opts, watch) {
  var targets = q(op.selector);
  // Snapshot: inline styles of everything this op could touch, plus each
  // target's position in the DOM (so a move can be put back), plus the set of
  // already-injected nodes (so nodes this op adds can be identified and removed).
  var snapshot = targets.map(function (el) {
    return { el: el, style: el.getAttribute("style"), parent: el.parentElement, next: el.nextSibling, text: el.innerHTML };
  });
  var addedBefore = q("[data-ecd-added]");
  var beforeKeys = overlapKeys(rectsOf(watch));
  var locked = heightLockedRegions();
  // What the page looked like around the target, so an op that changes nothing
  // can be told apart from one that works.
  var sigBefore = layoutSignature(targets);

  var result = applyOp(op, brand, opts);
  if (!result.applied) return result;

  var violation = lockedRegionViolation(locked);
  if (violation) {
    undoOp(snapshot, addedBefore);
    result.applied = false;
    result.skipped = (result.skipped || []).concat(["reverted: this edit " + violation]);
    return result;
  }

  if (newCollisions(watch, beforeKeys) > 0) {
    undoOp(snapshot, addedBefore);
    result.applied = false;
    result.skipped = (result.skipped || []).concat(["reverted: this edit made existing elements overlap"]);
    return result;
  }

  // Nothing was injected and nothing moved: the edit ran but the page looks
  // exactly as it did, so the fix is NOT applied however successful the op call
  // was. Reporting it as done is how a header "fix" shipped that changed nothing.
  var addedNow = q("[data-ecd-added]");
  var injected = addedNow.length > addedBefore.length;
  if (!injected && layoutSignature(targets) === sigBefore) {
    result.applied = false;
    result.skipped = (result.skipped || []).concat(["no visible change: the page renders identically"]);
    return result;
  }

  // An element added below the captured area is not in the concept image, so the
  // fix is not demonstrated even though the edit ran. A star rating landed off
  // the shot this way and read as simply missing. The budget is TWO viewports,
  // not one: the capture takes the first fold plus a second-fold shot, and on a
  // mobile collection page every product card lives below the first fold, so a
  // one-viewport rule wrongly voided every per-card quick add.
  if (injected) {
    var fresh = addedNow.filter(function (n) {
      return addedBefore.indexOf(n) === -1 && !n.hasAttribute("data-ecd-scrim");
    });
    var anyOnScreen = fresh.some(function (n) {
      var r = n.getBoundingClientRect();
      return r.height > 0 && r.width > 0 && r.top < window.innerHeight * 2 && r.bottom > 0;
    });
    if (fresh.length > 0 && !anyOnScreen) {
      result.skipped = (result.skipped || []).concat(["added below the captured area (two viewports), so it is not in the image"]);
      result.offscreen = true;
      result.applied = false;
    }
  }
  return result;
}

function run(ops, opts) {
  var brand = brandTokens(opts.brand);
  var before = photoState();
  var watch = atomicElements();
  var report = { ops: [], notes: [], brand: { buttonBg: brand.buttonBg, clonedFrom: brand.clonedFrom } };
  (ops || []).forEach(function (op, i) {
    CURRENT_OP = i;
    try {
      report.ops.push(applyOpGuarded(op, brand, opts, watch));
    } catch (e) {
      report.ops.push({
        op: op && op.op, selector: (op && op.selector) || null, fix_index: (op && op.fix_index) || null,
        applied: false, matched: 0, skipped: [], error: String((e && e.message) || e).slice(0, 160),
      });
    }
  });
  CURRENT_OP = -1;

  // FIT PASS. Injections into a fixed-height hero push the content stack down,
  // and the theme clips the overflow: the CTA came back sliced in half at the
  // hero's bottom edge. For every scrimmed backdrop (i.e. every hero we put
  // content over), if anything now sticks out of its section, first tighten the
  // injected rows' spacing, then thin an added pill row, and as a last resort
  // remove the pill row entirely rather than ship a cut-off button.
  q("[data-ecd-scrim]").forEach(function (scrim) {
    // The section has to hold BOTH the photo backdrop and the overlay with the
    // copy and button: measuring the backdrop alone saw "no overflow" while the
    // call-to-action, which lives in a sibling subtree, hung out of the hero.
    var backdrop = scrim.parentElement;
    var section = backdrop ? backdrop.parentElement : null;
    for (var fd = 0; fd < 5 && section && section !== document.body; fd++) {
      var r = section.getBoundingClientRect();
      var hasOverlayContent = Array.prototype.slice.call(section.querySelectorAll("a, button"))
        .some(function (n) { return isVisible(n) && !backdrop.contains(n); });
      if (r.height >= 300 && r.width >= window.innerWidth * 0.8 && hasOverlayContent) break;
      section = section.parentElement;
    }
    if (!section || section === document.body) return;
    var overflowPx = function () {
      var bottom = section.getBoundingClientRect().bottom;
      var worst = 0;
      Array.prototype.slice.call(section.querySelectorAll("a, button, p, div, span")).forEach(function (n) {
        if (!isVisible(n)) return;
        var nb = n.getBoundingClientRect();
        if (nb.height < 8 || nb.height > 200) return;
        worst = Math.max(worst, nb.bottom - bottom);
      });
      return worst;
    };
    if (overflowPx() <= 4) return;
    var added = Array.prototype.slice.call(section.querySelectorAll("[data-ecd-added]"))
      .filter(function (n) { return !n.hasAttribute("data-ecd-scrim"); });
    // Step 1: tighter spacing on everything we added.
    added.forEach(function (n) {
      n.style.setProperty("margin-top", "6px", "important");
      n.style.setProperty("margin-bottom", "0", "important");
    });
    if (overflowPx() <= 4) return;
    // Step 2: a pill row down to three, then two, entries.
    var pillRow = added.filter(function (n) { return n.children.length >= 3 && n.tagName === "DIV"; })[0];
    if (pillRow) {
      while (pillRow.children.length > 2 && overflowPx() > 4) {
        pillRow.removeChild(pillRow.lastElementChild);
      }
      if (overflowPx() <= 4) return;
      // Step 3: the pills lose to a sliced call-to-action.
      if (pillRow.parentElement) pillRow.parentElement.removeChild(pillRow);
    }
  });

  // One bounding box per APPLIED op, measured after every op has run because a
  // later edit shifts earlier elements. These become the numbered pins on the
  // After image in the report, so a reader can see exactly what changed instead
  // of hunting for it. Percentages of the first-fold shot, the image shown.
  report.ops.forEach(function (r, i) {
    if (!r.applied) return;
    var nodes = q('[data-ecd-op="' + i + '"]').filter(isVisible);
    if (nodes.length === 0) return;
    var L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    nodes.forEach(function (n) {
      var b = n.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      L = Math.min(L, b.left); T = Math.min(T, b.top);
      R = Math.max(R, b.right); B = Math.max(B, b.bottom);
    });
    if (!(R > L && B > T)) return;
    if (T >= window.innerHeight) return; // below the published crop
    B = Math.min(B, window.innerHeight);
    var pct = function (v, base) { return Math.round(Math.max(0, Math.min(100, v / base * 100)) * 10) / 10; };
    r.box = {
      x: pct(L, window.innerWidth),
      y: pct(T, window.innerHeight),
      w: Math.max(1, pct(R - L, window.innerWidth)),
      h: Math.max(1, pct(B - T, window.innerHeight)),
    };
  });

  report.photos = photoDiff(before);
  return report;
}
`;

export type EditOpResult = {
  op?: string;
  selector?: string | null;
  fix_index?: number | null;
  matched?: number;
  applied?: boolean;
  skipped?: string[];
  error?: string;
  /** Where this edit landed, as percentages of the published first-fold shot.
   * Measured after every op has run; absent for reverted or off-shot edits. */
  box?: { x: number; y: number; w: number; h: number };
};

export type EditReport = {
  ops?: EditOpResult[];
  photos?: { before: number; after: number; changed: string[] };
  brand?: Record<string, unknown>;
  notes?: string[];
};

/** Build the script that Browserless evaluates: the fixed runtime above plus the
 * ops as DATA. The model's output is never executed as code. */
export function renderEditScript(ops: EditOp[], opts: { isMobile: boolean; brand?: Record<string, unknown> }): string {
  return `${EDIT_RUNTIME}\nreturn run(${JSON.stringify(ops)}, ${JSON.stringify(opts)});`;
}

// ---------------------------------------------------------------------------
// 4. The author: Claude picks the ops from the findings + the page outline
// ---------------------------------------------------------------------------

const AUTHOR_SYSTEM = [
  "You are a senior e-commerce UX designer producing a CONCEPT REDESIGN of a real storefront page. You are given the page as a DOM outline plus the fixes an audit recommended. You return concrete DOM/CSS edits; the edited page is screenshotted side by side with the original as the before/after in a paid report.",
  "",
  "THE BAR: a client glancing at the two images must SEE the transformation in two seconds. A concept that looks 95% identical to the original reads as no work done, however correct the edits are. Concentrate visible change in the first fold: a rewritten headline that actually sells, ONE unmissable hero call-to-action (variant 'hero'), a proof line, category pills over the hero using the store's real nav names, a rebalanced header when any finding mentions the header. Aim for every finding served by a change a non-designer can point at.",
  "",
  "Bold is not busy: a few strong, well-spaced changes, never a pile of small ones. Rewrite existing copy IN PLACE rather than adding lines beside it.",
  "",
  "This is a real page in a real browser, not a picture. That means:",
  "- The photographs, fonts, colours and logo are the client's own and are already correct. You never need to change them, and you cannot: any edit that would resize or reframe a photo is refused by the runtime.",
  "- Anything you add is styled automatically from the theme's own button colour, radius and fonts. Do not try to specify colours yourself.",
  "- 'move' physically relocates an element, so it can never leave a duplicate behind. Prefer it over hiding one thing and adding another.",
  "",
  "RULES:",
  "- Use ONLY selectors that appear in the supplied outline, exactly as written. A selector that matches nothing is a wasted edit.",
  "- Serve EVERY requested fix with at least one edit, and set fix_index so each edit names the fix it serves. If a fix genuinely cannot be expressed as a DOM edit (it asks for new photography, or for a page that does not exist), skip it rather than faking it.",
  "- Prefer the smallest edit that makes the fix visible. Two or three precise edits beat ten speculative ones.",
  "- Never invent facts. Only state a review count, a rating, a delivery time or a price that the outline already shows. If a fix asks for social proof the page does not have, add the element with the page's own numbers or leave it out.",
  "- Keep the result calmer than the original, never busier. Do not stack many small additions. On a phone especially, restraint wins: one clear addition per area.",
  "- On a phone, product grids stay ONE card per row. Never ask for more (the runtime clamps it anyway).",
  "- Only add a quick-add control to product cards or cart upsell rows with variant 'compact', so it sits on the existing row instead of making the card or the cart drawer taller.",
  "- A per-card control goes ON EVERY CARD: use the card node's 'all' selector with each:true. NEVER append a single control to a grid, section or page wrapper; it lands at the bottom of the section, far from any product, and will be voided as not visible.",
  "- Do not repeat information already on the page. If the announcement bar already states free shipping, do not add a second free-shipping line.",
  "",
  "Layout knowledge to apply:",
  HTML_AFTER_RULES,
].join("\n");

export type AuthorResult = {
  ops: EditOp[];
  servedFixes: number[];
  error?: string;
};

/** Ask Claude for the edit ops. Returns an empty op list rather than throwing,
 * so the caller can fall back to the image path. */
export async function authorHtmlAfterEdits(
  pageLabel: string,
  recommendations: string[],
  outline: DomOutline,
  viewport: Viewport,
): Promise<AuthorResult> {
  if (recommendations.length === 0) return { ops: [], servedFixes: [] };
  try {
    const llm = createLlmClient("anthropic", { model: EDIT_AUTHOR_MODEL });
    const fixes = recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const messages: LlmMessage[] = [{
      role: "user",
      text: [
        `PAGE: the ${pageLabel} of an e-commerce storefront, viewed on ${viewport === "mobile" ? "a phone (single column)" : "a desktop browser"}.`,
        `VIEWPORT: ${outline.viewport?.w ?? "?"}x${outline.viewport?.h ?? "?"} CSS pixels. Nodes below with a y beyond that height are below the fold; the screenshot shows the first fold, so prioritise fixes that land inside it.`,
        "",
        "FIXES THE AUDIT ASKED FOR:",
        fixes,
        "",
        "PAGE OUTLINE. Each node has: sel = a selector matching THAT ONE element; all = a selector matching EVERY repeated sibling like it (product cards, cart rows) with allN = how many; role; box = [x, y, width, height]; text; n = elements sel matches; imgs = images inside; cols = cards per row.",
        "IMPORTANT: to edit every product card or every cart row, use the node's 'all' selector together with each:true. Using a 'sel' that contains :nth-of-type puts your edit on a single card and leaves the rest of the grid untouched.",
        JSON.stringify(outline.nodes ?? []),
        "",
        "Call record_page_edits exactly once with the edits that make every fix above visible on this page.",
      ].join("\n"),
    }];
    const turn = await llm.runTurn({
      system: AUTHOR_SYSTEM,
      messages,
      tools: [EDIT_TOOL],
      toolChoice: { type: "tool", name: "record_page_edits" },
    });
    if (turn.kind !== "tool_call") return { ops: [], servedFixes: [], error: "author_no_tool_call" };
    const raw = (turn.input ?? {}) as { edits?: unknown };
    const ops = (Array.isArray(raw.edits) ? raw.edits : [])
      .map((e) => e as EditOp)
      .filter((e) => e && typeof e.op === "string");
    const servedFixes = [...new Set(ops.map((o) => Number(o.fix_index)).filter((n) => Number.isFinite(n) && n > 0))];
    return { ops, servedFixes };
  } catch (e) {
    return { ops: [], servedFixes: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// 5. The run: outline -> author -> apply -> re-shoot
// ---------------------------------------------------------------------------

export type HtmlAfterRun =
  | {
    ok: true;
    png: Uint8Array;
    png2?: Uint8Array | null;
    /** Per-op result from the in-page runtime: what matched, what applied. */
    report: EditReport;
    ops: EditOp[];
    /** Fixes no edit served, or whose edits all failed to match. */
    unapplied: string[];
    /** Browserless calls spent (1 when a stored outline was reused, else 2). */
    captures: number;
  }
  | { ok: false; error: string; stage: "outline" | "author" | "apply"; ops?: EditOp[]; report?: EditReport };

/** Build one "after" image by editing the real page. Never throws. */
export async function runHtmlAfter(input: {
  pageUrl: string;
  pageLabel: string;
  viewport: Viewport;
  recommendations: string[];
  /** Outline captured alongside the "before" screenshot, when available: reusing
   * it saves a whole page load and describes the page exactly as it was shot. */
  outline?: unknown;
  cartAdd?: { variantId?: string | null; productUrl?: string | null };
  proxyTier?: "datacenter" | "residential";
  timeoutMs?: number;
  /** Also return the next fold down, as evidence for edits below the crop. */
  secondFold?: boolean;
}): Promise<HtmlAfterRun> {
  const { captureWithBrowserless } = await import("./browserless.ts");
  const isMobile = input.viewport === "mobile";
  let captures = 0;
  const startedAt = Date.now();

  // Storefronts rate-limit the cheap datacenter pool (a probe came back
  // "storefront_blocked (http 429)" and sent a perfectly good page to the image
  // model instead). Residential is the same escalation the main capture path
  // already uses, so a block costs one retry rather than the whole engine.
  const capture = async (opts: Record<string, unknown>) => {
    const first = await captureWithBrowserless({
      url: input.pageUrl,
      viewport: input.viewport,
      fullPage: false,
      withElements: false,
      cartAdd: input.cartAdd,
      proxyTier: input.proxyTier,
      timeoutMs: input.timeoutMs,
      ...opts,
    } as Parameters<typeof captureWithBrowserless>[0]);
    captures++;
    if (first.ok) return first;

    // A slow storefront costs an after-image otherwise. Two transient failures
    // are worth one more go, and the second attempt goes out over residential:
    //  - a block or 429 means the cheap datacenter pool is being refused;
    //  - a navigation timeout is just a slow page load, and falling back to the
    //    image model for one is a bad trade. On this audit two desktop pages
    //    timed out, went to the image model, and one of them had its photos
    //    damaged and the whole image withheld by the photo gate.
    const worthRetrying = /blocked|429|rate.?limit|too many requests|timeout|navigation/i.test(first.error);
    if (!worthRetrying || input.proxyTier === "residential") return first;
    // Only if a second load still fits inside the caller's budget: the cart
    // flow chains several navigations and cannot afford one.
    if (Date.now() - startedAt > 70_000) return first;

    const second = await captureWithBrowserless({
      url: input.pageUrl,
      viewport: input.viewport,
      fullPage: false,
      withElements: false,
      cartAdd: input.cartAdd,
      proxyTier: "residential",
      timeoutMs: input.timeoutMs,
      ...opts,
    } as Parameters<typeof captureWithBrowserless>[0]);
    captures++;
    return second;
  };

  // 1. The outline. Reuse the stored one; otherwise probe the live page.
  let outline: DomOutline | null = isUsableOutline(input.outline) ? input.outline : null;
  if (!outline) {
    const probeShot = await capture({ probeScript: DOM_OUTLINE_PROBE });
    if (!probeShot.ok) return { ok: false, error: `probe_capture: ${probeShot.error}`, stage: "outline" };
    if (!isUsableOutline(probeShot.probe)) {
      const err = (probeShot.probe as { error?: string } | null)?.error;
      return { ok: false, error: `outline_unusable${err ? `: ${err}` : ""}`, stage: "outline" };
    }
    outline = probeShot.probe;
  }

  // 2. Claude picks the edits from the fixes plus the outline.
  const authored = await authorHtmlAfterEdits(input.pageLabel, input.recommendations, outline, input.viewport);
  if (authored.ops.length === 0) {
    return { ok: false, error: authored.error ?? "author_returned_no_edits", stage: "author" };
  }

  // 3. Apply them to the real page and re-shoot it.
  const shot = await capture({
    secondFold: input.secondFold,
    editScript: renderEditScript(authored.ops, { isMobile, brand: outline.brand ?? {} }),
  });
  if (!shot.ok) return { ok: false, error: `edit_capture: ${shot.error}`, stage: "apply", ops: authored.ops };

  const report = (shot.editReport ?? {}) as EditReport;
  const summary = summarizeEditReport(report, input.recommendations);

  // The deterministic photo gate. It should never fire, because nothing here
  // touches a photo; if it ever does, the caller falls back rather than
  // publishing a page whose imagery moved.
  if (summary.photoDefects.length > 0) {
    return {
      ok: false,
      error: `photo_integrity: ${summary.photoDefects.join(" | ").slice(0, 240)}`,
      stage: "apply",
      ops: authored.ops,
      report,
    };
  }
  // Nothing landed, so the "after" would be an unedited screenshot of the page:
  // worse than no image at all. The two ways that happens are worth telling
  // apart, because only one is a defect. Guards reverting every edit is the
  // engine correctly refusing to break a page (a tight cart drawer that cannot
  // take another row); selectors matching nothing is an authoring failure.
  if (!report.ops?.some((r) => r.applied)) {
    const allGuarded = (report.ops ?? []).length > 0 &&
      (report.ops ?? []).every((r) => (r.skipped ?? []).some((s) => /reverted|already|no visible change|captured area/i.test(s)));
    return {
      ok: false,
      error: allGuarded ? "all_edits_guarded" : "no_edit_applied",
      stage: "apply",
      ops: authored.ops,
      report,
    };
  }

  return { ok: true, png: shot.png, png2: shot.png2 ?? null, report, ops: authored.ops, unapplied: summary.unapplied, captures };
}

/** Which fixes the HTML pass genuinely applied, judged from the runtime's own
 * report rather than by looking at a picture: a fix is applied when at least one
 * edit serving it matched an element and ran. */
export function summarizeEditReport(
  report: EditReport,
  recommendations: string[],
): { applied: number[]; unapplied: string[]; failedOps: number; photoDefects: string[] } {
  const results = Array.isArray(report.ops) ? report.ops : [];
  const applied = new Set<number>();
  let failedOps = 0;
  for (const r of results) {
    // An op the duplication guards refused still leaves the page with the thing
    // its fix asked for: two findings often both ask for a quick add on the
    // collection grid, and the second is skipped precisely because the first
    // already delivered it. Counting that as unapplied would under-report the
    // work, so a guard skip counts as served while a genuine miss does not.
    const guarded = (r.skipped ?? []).some((s) => /already/i.test(s));
    if ((r.applied || guarded) && r.fix_index) applied.add(Number(r.fix_index));
    if (!r.applied && !guarded) failedOps++;
  }
  const unapplied = recommendations.filter((_, i) => !applied.has(i + 1));
  return {
    applied: [...applied].sort((a, b) => a - b),
    unapplied,
    failedOps,
    photoDefects: report.photos?.changed ?? [],
  };
}
