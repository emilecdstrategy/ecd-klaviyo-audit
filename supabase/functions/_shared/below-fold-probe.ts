// What is below the fold.
//
// The audit judges each page from an above-the-fold screenshot, so everything
// past the first screen was invisible to it: the product description, reviews,
// cross-sells, FAQ, trust content and the footer. The model filled the gap by
// guessing, which is how a report ends up claiming a store has no reviews when
// it has four hundred.
//
// A second screenshot would cost a capture per page. This costs nothing: it
// runs in the page load the screenshot already needs, and reports the STRUCTURE
// below the fold. That cannot judge how a section looks, but it settles whether
// the section exists, which is where the wrong claims were being made.

/** Read off the settled page, below the fold only. */
export type BelowFoldReport = {
  page: { scroll_height: number; viewport_height: number; folds: number };
  /** Section headings below the fold, in page order. */
  headings: Array<{ level: number; text: string; y: number }>;
  /** Whether a recognisable block of each kind exists below the fold. */
  features: Record<string, { found: boolean; note?: string; y?: number; empty?: boolean }>;
  footer: { found: boolean; links: number; has_contact: boolean; has_social: boolean; has_policies: boolean };
  words: number;
  images: number;
  error?: string;
};

/** The probe body. Runs in the page, returns a BelowFoldReport.
 *
 * Detection is deliberately conservative: a feature is only reported found when
 * a real element or a real phrase is there. "Not found" therefore means "not
 * found by these rules", which is why the evidence text below says so out loud
 * rather than letting the model read it as proof of absence. */
export const BELOW_FOLD_PROBE = String.raw`
const VH = window.innerHeight;
const FOLD = VH * 0.9; // a little slack: a section straddling the crop counts as below
const docH = Math.max(
  document.body ? document.body.scrollHeight : 0,
  document.documentElement ? document.documentElement.scrollHeight : 0,
);

function topOf(el) {
  try {
    const r = el.getBoundingClientRect();
    return Math.round(r.top + window.scrollY);
  } catch (e) { return -1; }
}

// Opacity is deliberately NOT part of this test.
//
// The page is measured without scrolling, and scroll-reveal is the norm: a
// theme fades its below-fold sections in as you reach them, so at rest they sit
// at opacity 0 while being perfectly real content. Judging them hidden reported
// a store's whole email signup block as absent. display:none, visibility:hidden
// and a collapsed box still mean hidden, because those survive scrolling.
function visible(el) {
  try {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  } catch (e) { return false; }
}

function belowFold(el) {
  const y = topOf(el);
  return y >= FOLD && y <= docH + VH;
}

// CSS substring matching has no word boundaries, so [class*="review"] also
// matches "preview-img": a skeleton placeholder image reported a store as
// already having customer reviews, which would have suppressed a real
// recommendation. Where a hook is a common substring of other words, the match
// is confirmed against the element's class and id split into tokens.
function hasToken(el, re) {
  const raw = ((el.className && el.className.toString ? el.className.toString() : "") + " " + (el.id || "")).toLowerCase();
  const tokens = raw.split(/[^a-z0-9]+/);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] && re.test(tokens[i])) return true;
  }
  return false;
}

function pick(selectors, tokenRe) {
  for (let i = 0; i < selectors.length; i++) {
    let list = [];
    try { list = Array.prototype.slice.call(document.querySelectorAll(selectors[i])); } catch (e) { continue; }
    for (let j = 0; j < list.length; j++) {
      const el = list[j];
      // A feature block is never a bare image or icon. Skeleton placeholders and
      // decorative svgs match class hooks constantly and mean nothing.
      const tag = el.tagName;
      if (tag === "IMG" || tag === "SVG" || tag === "svg" || tag === "PATH") continue;
      if (tokenRe && !hasToken(el, tokenRe)) continue;
      if (visible(el) && belowFold(el)) return { el: el, sel: selectors[i] };
    }
  }
  return null;
}

// Text of the page below the fold, once, for phrase matching.
//
// The first version walked block elements and kept only leaf-ish ones, to stop
// a wrapper contributing its children twice. On a real theme almost every text
// container nests a div, so the filter threw away most of the page: a twelve
// screen homepage reported 323 words, and every phrase fallback was matching
// against a fraction of the copy. Walking text nodes counts each word exactly
// once with no guess about which element "owns" it.
let belowText = "";
let wordCount = 0;
try {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const foldCache = new WeakMap();
  let node;
  while ((node = walker.nextNode()) && belowText.length < 80000) {
    const t = (node.nodeValue || "").trim();
    if (!t) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
    let ok = foldCache.get(parent);
    if (ok === undefined) {
      ok = belowFold(parent) && visible(parent);
      foldCache.set(parent, ok);
    }
    if (!ok) continue;
    belowText += " " + t;
  }
  wordCount = belowText.split(/\s+/).filter(Boolean).length;
} catch (e) {}
const lower = belowText.toLowerCase();
const says = function (re) { return re.test(lower); };

function phrase(re, label) {
  return says(re) ? { found: true, note: label } : { found: false };
}

function merge(byEl, byPhrase) {
  if (byEl) {
    const out = { found: true, note: byEl.sel, y: topOf(byEl.el) };
    // A section can exist in the theme and still show nothing: a
    // recommendations block with no recommendations configured is a container
    // with no content. Calling that "present" would bury a real finding, so the
    // difference is recorded rather than flattened.
    try {
      const hasText = ((byEl.el.innerText || "").trim().length) > 0;
      const hasLinks = byEl.el.querySelectorAll('a[href*="/products/"], img, li').length > 0;
      if (!hasText && !hasLinks) out.empty = true;
    } catch (e) {}
    return out;
  }
  return byPhrase || { found: false };
}

// --- headings -------------------------------------------------------------
const headings = [];
try {
  const hs = Array.prototype.slice.call(document.querySelectorAll("h1, h2, h3, h4"));
  for (let i = 0; i < hs.length && headings.length < 40; i++) {
    const el = hs[i];
    if (!belowFold(el) || !visible(el)) continue;
    const text = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 90);
    if (!text) continue;
    headings.push({ level: Number(el.tagName.slice(1)), text: text, y: topOf(el) });
  }
  headings.sort(function (a, b) { return a.y - b.y; });
} catch (e) {}

// --- features -------------------------------------------------------------
// Class and id hooks first, because a review app leaves its name in the markup;
// a phrase match is the fallback for themes that name nothing.
const features = {};

features.reviews = merge(
  pick([
    '[class*="judgeme" i]', '[class*="jdgm" i]', '[class*="yotpo" i]', '[class*="okendo" i]',
    '[class*="stamped" i]', '[class*="loox" i]', '[class*="reviewsio" i]', '[class*="junip" i]',
    '[id*="review" i]', '[class*="review" i]', '[data-reviews]',
  ], /^(reviews?|judgeme|jdgm|yotpo|okendo|stamped|loox|reviewsio|junip)/),
  phrase(/\b\d+\s+reviews?\b|customer reviews|verified (buyer|purchase)|write a review/, "phrase"),
);

features.recommendations = merge(
  pick([
    '[class*="recommend" i]', '[class*="related" i]', '[class*="upsell" i]', '[class*="cross-sell" i]',
    '[class*="complete-the-look" i]', '[class*="also-bought" i]', 'product-recommendations',
  ]),
  phrase(/you (may|might) also like|complete the look|pairs well with|frequently bought|customers also|shop the look|related products/, "phrase"),
);

features.faq = merge(
  pick(['details', '[class*="accordion" i]', '[class*="faq" i]', '[id*="faq" i]', '[class*="collaps" i]']),
  phrase(/frequently asked|faqs?\b/, "phrase"),
);

features.trust_signals = merge(
  pick(['[class*="trust" i]', '[class*="guarantee" i]', '[class*="badge" i]', '[class*="usp" i]']),
  phrase(/free (shipping|delivery)|money.?back|satisfaction guarantee|secure (checkout|payment)|\d+.?day (returns|guarantee)|carbon neutral|as seen in/, "phrase"),
);

features.ugc = merge(
  pick(['[class*="instagram" i]', '[class*="ugc" i]', '[class*="social-feed" i]', '[class*="foursixty" i]', '[class*="tagged" i]']),
  phrase(/follow us on|shop our instagram|@[a-z0-9_.]{3,}/, "phrase"),
);

features.video = merge(
  pick(['video', 'iframe[src*="youtube" i]', 'iframe[src*="vimeo" i]', 'iframe[src*="wistia" i]']),
  { found: false },
);

features.newsletter_signup = merge(
  pick(['footer input[type="email"]', 'input[type="email"]', '[class*="newsletter" i]', '[class*="signup" i]']),
  phrase(/sign up|subscribe|join (our|the) (list|club|newsletter)|get \d+% off/, "phrase"),
);

features.size_or_fit_guide = merge(
  pick(['[class*="size-guide" i]', '[class*="sizing" i]', '[class*="fit-guide" i]']),
  phrase(/size (guide|chart)|find your (size|fit)|measurements/, "phrase"),
);

features.shipping_or_returns_info = merge(
  pick(['[class*="shipping" i]', '[class*="returns" i]', '[class*="delivery" i]']),
  phrase(/shipping (info|policy|rates)|returns? (policy|within)|delivery (times|options)|exchanges/, "phrase"),
);

features.live_chat = merge(
  pick(['[class*="intercom" i]', '[class*="gorgias" i]', '[class*="tidio" i]', '[class*="crisp" i]', '[id*="chat" i]']),
  { found: false },
);

// A sticky add to cart is fixed rather than below the fold, so it is found by
// position instead: it is exactly what keeps the buy button reachable on a long
// page, and its absence is a real finding.
features.sticky_buy_button = { found: false };
try {
  const all = Array.prototype.slice.call(document.querySelectorAll("button, a, [role='button'], form"));
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const fixedish = cs.position === "fixed" || cs.position === "sticky";
    if (!fixedish) continue;
    const t = ((el.innerText || "") + " " + (el.getAttribute("name") || "")).toLowerCase();
    if (/add to (cart|bag)|buy now|add to basket|subscribe and save/.test(t)) {
      features.sticky_buy_button = { found: true, note: cs.position };
      break;
    }
  }
} catch (e) {}

// --- footer ---------------------------------------------------------------
const footer = { found: false, links: 0, has_contact: false, has_social: false, has_policies: false };
try {
  // querySelector takes the FIRST match in document order, which on a real theme
  // is a decorative "footer-something" wrapper near the top, not the footer:
  // that reported a store with a full footer as having zero links. The real
  // footer is the candidate carrying the most links.
  let f = null;
  let bestLinks = -1;
  const cands = Array.prototype.slice.call(
    document.querySelectorAll("footer, [class*='footer' i], [id*='footer' i]"),
  );
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!visible(c)) continue;
    const n = c.querySelectorAll("a").length;
    if (n > bestLinks) { bestLinks = n; f = c; }
  }
  if (f && visible(f)) {
    const ftext = (f.innerText || "").toLowerCase();
    footer.found = true;
    footer.links = f.querySelectorAll("a").length;
    footer.has_contact = /contact|support@|help@|info@|\+?\d[\d\s()-]{7,}/.test(ftext) ||
      Boolean(f.querySelector('a[href^="mailto:"], a[href^="tel:"]'));
    footer.has_social = Boolean(
      f.querySelector('a[href*="instagram" i], a[href*="facebook" i], a[href*="tiktok" i], a[href*="youtube" i], a[href*="pinterest" i], a[href*="linkedin" i]'),
    );
    footer.has_policies = /privacy|terms|refund|shipping policy|returns/.test(ftext);
  }
} catch (e) {}

// --- images ---------------------------------------------------------------
let images = 0;
try {
  const imgs = Array.prototype.slice.call(document.querySelectorAll("img"));
  for (let i = 0; i < imgs.length; i++) {
    if (belowFold(imgs[i]) && visible(imgs[i])) images++;
  }
} catch (e) {}

return {
  page: { scroll_height: Math.round(docH), viewport_height: Math.round(VH), folds: Math.max(1, Math.round((docH / VH) * 10) / 10) },
  headings: headings,
  features: features,
  footer: footer,
  words: wordCount,
  images: images,
};
`;

/** Run two probe bodies in one page evaluation and merge the results. There is
 *  a single probe slot per capture, and both of these want the same settled
 *  page, so they share it rather than costing a second load. */
export function composeProbes(outlineBody: string, belowFoldBody: string): string {
  const wrap = (body: string) => `await (async () => {\n${body}\n})()`;
  return [
    `let __outline = null, __below = null;`,
    `try { __outline = ${wrap(outlineBody)}; } catch (e) { __outline = { error: String(e && e.message || e).slice(0, 200) }; }`,
    `try { __below = ${wrap(belowFoldBody)}; } catch (e) { __below = { error: String(e && e.message || e).slice(0, 200) }; }`,
    `return Object.assign({}, __outline || {}, { below_fold: __below });`,
  ].join("\n");
}

export function isBelowFoldReport(v: unknown): v is BelowFoldReport {
  const r = v as BelowFoldReport | null;
  return Boolean(r && r.page && typeof r.page.scroll_height === "number" && !r.error);
}

const FEATURE_LABELS: Record<string, string> = {
  reviews: "customer reviews",
  recommendations: "product recommendations or cross-sells",
  faq: "an FAQ or accordion",
  trust_signals: "trust or guarantee content",
  ugc: "user generated or social content",
  video: "video",
  newsletter_signup: "an email signup",
  size_or_fit_guide: "a size or fit guide",
  shipping_or_returns_info: "shipping or returns information",
  live_chat: "live chat",
  sticky_buy_button: "a sticky buy button",
};

/** The evidence block handed to the vision model. Written the same way as the
 *  hover evidence: state what was measured, and state plainly where the
 *  measurement is silent, so the model cannot read absence as proof. */
export function belowFoldEvidence(entries: Array<{ ref: string; report: unknown }>): string {
  const usable = entries.filter((e) => isBelowFoldReport(e.report)) as Array<{ ref: string; report: BelowFoldReport }>;
  if (usable.length === 0) {
    return "\n\nThe page below the fold was not measured on this page, so make NO claim about what is or is not further down. Judge only what the screenshots show.";
  }
  const lines: string[] = [];
  for (const { ref, report } of usable) {
    const parts: string[] = [];
    parts.push(`the page is ${report.page.folds} screens tall`);
    const label = (k: string) => FEATURE_LABELS[k] ?? k;
    const found = Object.entries(report.features)
      .filter(([, v]) => v.found)
      .map(([k, v]) => (v.empty ? label(k) + " (the block is there but rendered nothing, so it may not be configured)" : label(k)));
    const missing = Object.entries(report.features).filter(([, v]) => !v.found).map(([k]) => label(k));
    parts.push(found.length ? `present below the fold: ${found.join(", ")}` : "nothing recognisable below the fold");
    if (missing.length) parts.push(`NOT found anywhere below the fold: ${missing.join(", ")}`);
    if (report.headings.length) {
      parts.push(`section headings below the fold, in order: ${report.headings.map((h) => `"${h.text}"`).join(" / ")}`);
    } else {
      parts.push("no section headings at all below the fold");
    }
    parts.push(
      report.footer.found
        ? `footer: ${report.footer.links} links, contact details ${report.footer.has_contact ? "yes" : "no"}, social links ${report.footer.has_social ? "yes" : "no"}, policy links ${report.footer.has_policies ? "yes" : "no"}`
        : "no footer found",
    );
    parts.push(`${report.words} words and ${report.images} images below the fold`);
    lines.push(`${ref}: ${parts.join("; ")}.`);
  }
  return (
    "\n\nBELOW THE FOLD. The screenshots stop at the first screen, so what follows was read off the live page after it settled. It is measured, not inferred:\n" +
    lines.join("\n") +
    "\n\nUse it. A section listed as NOT found really is absent, so recommending it is a genuine opportunity and worth saying plainly. A section listed as present exists, so never recommend adding it: if it needs work, say what to change about it instead. Never describe how a below-the-fold section LOOKS, because no screenshot of it was taken: describe only whether it is there and what it should do."
  );
}
