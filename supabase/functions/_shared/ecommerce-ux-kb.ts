// A compact e-commerce UI/UX + conversion knowledge base shared by the web-audit
// agents (findings + "after" image generation). It encodes the standard,
// shopper-familiar layout of each storefront page plus the common anti-patterns
// to avoid, so generated concepts follow real conventions instead of inventing
// odd structures (e.g. two stacked product images with carousel arrows between).

export type WebPageKind = "homepage" | "product" | "collection" | "cart";

export const GENERAL_LAYOUT_RULES = [
  "Follow standard, conventional e-commerce layouts that shoppers already recognize. Never invent unusual or experimental structures.",
  "Never duplicate a section or element: show each image, heading, button, or block once. Never stack two copies of the same image, and never place carousel arrows between two separate images.",
  "Never add a second headline or subheadline. There must be exactly one headline and at most one subheadline in the hero. If the copy needs to change, EDIT the existing text in place, do not keep the old line and add a new one above or below it.",
  "Improve elements in place. If the page already has something a fix refers to (category shortcuts, a search bar, reviews, a menu), enhance the existing one; never add a second duplicate copy of it.",
  "All buttons must be a solid, flat, single brand-color fill with legible text. Never give a button stripes, patterns, textures, gradients, noise, or a see-through fill.",
  "Actually apply positioning fixes: if a fix says elements overlap or a row is cramped (e.g. a floating chat or loyalty button covering other content), visibly move them apart in the redesign so the fix is clearly shown.",
  "Only change what the fixes require. Leave global elements (the header, navigation, and footer) exactly as in the original screenshot unless a fix explicitly changes them, so they stay consistent across pages.",
  "Keep one clear visual flow down the page, with related things grouped and consistent spacing and alignment.",
  "One primary action per screen; anything secondary must clearly look secondary.",
  "NEVER change, rewrite, relabel, restyle, move, hide, resize, or remove the location bar under the header that shows 'Growing Zone' and 'Planting in' (you might also think of it as the location bar, personalization bar, or zip/location detector). It is an automatic zip-code-based widget; reproduce it EXACTLY as in the original screenshot, in the same position (including the word 'n/a'). Do not turn it into a prompt like 'Enter your zip', do not add copy to it.",
  "Every element must look finished and real: aligned, evenly padded, no empty icon slots, no placeholder or label text.",
].join(" ");

// Guardrails for the FINDINGS agent so it doesn't fight standard conventions or
// recommend things the page already has.
export const FINDINGS_GUARDRAILS = [
  "Every finding MUST be a genuine improvement opportunity with a concrete change to make. NEVER submit a finding that just praises something or says to keep it as is (no 'this works well, keep it', no 'no change needed'). Positive observations belong in the strengths (pros) list, not in findings.",
  "A hamburger / collapsed menu on phones is the STANDARD, correct pattern. Never flag it as a problem, and never say category shortcuts should be visible without opening the menu.",
  "Never recommend adding an element the page already has. Look at the screenshot first: if category shortcuts, a search bar, reviews, or similar already exist, either leave them or suggest improving the existing one, do not suggest adding a duplicate.",
  "Header suggestions should be tasteful reorganizations (simplify a cramped header, center the logo, move a non-shopping icon like account into the menu), not blanket complaints that the menu is hidden.",
  "OFF LIMITS: the location bar under the header showing 'Growing Zone' and 'Planting in' (however you would describe it: location fields, location detector, personalization bar, zip bar, region selector). It is automatic zip-code-based detection and 'n/a' before a zip is entered is expected. NEVER write a finding about it in any form: do not call it broken, empty, or unfinished, do not say it wastes space or sits too high, and do not suggest moving, hiding, shrinking, relocating, or removing it. Say nothing about it at all.",
  "Only judge what you can actually SEE in the screenshot. These are above-the-fold shots, so content continues below the crop. NEVER write a finding about something being cut off, truncated, or missing at the bottom edge of the image, and never speculate about what is or is not further down the page. In particular, a horizontal row (category pills, product cards, a carousel) that runs past the right or bottom edge of the crop is normal scrollable content, not a defect: do not claim only N items are visible or that the row 'gets cut off'.",
  "NEVER CLAIM ABSENCE for anything that could simply sit below the crop. Do not write 'there is no X', 'X is missing', 'the page lacks X', or 'shoppers have no X' about reviews, star ratings, descriptions, specs, shipping or returns messaging, guarantees, trust badges, related products, or similar content that normally lives further down a page. You cannot see whether it exists. If placement is genuinely the point AND the anchor element is fully visible, frame it as placement about the visible area only, for example 'the price sits alone in the visible area, so consider surfacing a star rating beside it', never as a flat claim that the store has none.",
  "DO flag genuine, visible layout defects: floating widgets (chat bubbles, loyalty or rewards badges, back-to-top buttons, cookie bars) that overlap each other or cover real content; navigation or a button row that WRAPS onto a second line when it was clearly meant to sit on one; text overflowing or colliding with another element; and elements that are visibly misaligned or cramped. When a top-level nav wraps so one or two links drop to their own second row, say exactly that and recommend fitting it to a single row (shorter labels, or group the least-shopped items under one menu).",
  "Do not infer a catalog problem from a single visible option. If the size or variant selector shows only one value, that is almost certainly the only variant the product has, which is normal. NEVER suggest adding more sizes or variants, offering a bigger version, or upselling to another size based on the selector, and do not call a single option a missed opportunity. You cannot see the catalog, only the page. The same goes for stock: an out-of-stock product is a merchandising fact, not a page defect, so only comment on how clearly the page HANDLES it (a visible notice, a notify-me option, a link to alternatives) if those areas are actually visible.",
  "Do not nitpick things that follow standard e-commerce and platform conventions. Focus on changes that genuinely help shoppers.",
].join(" ");

// Sharper CRO heuristics for the FINDINGS agent, distilled for e-commerce
// storefronts. These make the recommendations more specific (headline, button
// copy, trust placement, objection handling) without changing the founder voice.
export const CRO_HEURISTICS = [
  "The 5-second test: a first-time visitor should grasp what the store sells and why it is for them within about five seconds of the page loading. If the hero fails this, that is the highest-priority fix.",
  "Speak in the shopper's benefit language, not internal jargon or clever slogans. Say what they get, not just what the product is.",
  "Headlines win on specificity: concrete outcomes, real numbers, or a clear 'get X without Y' promise beat a vague brand tagline.",
  "Button copy should signal the value of the next step, not a generic action. Prefer 'Shop best sellers' or 'Find my plant' over 'Shop now' or 'Submit'.",
  "Place trust and proof where decisions happen: put star ratings, review counts, and short testimonials right near the buy button and immediately after any benefit claim, not only in a separate section far down.",
  "Handle the obvious objections at the point of purchase: shipping cost and speed, returns, sizing or fit, and guarantees belong near the add-to-cart button, not buried in the footer.",
].join(" ");

export const LAYOUT_BRIEF: Record<WebPageKind, string> = {
  homepage:
    "HOMEPAGE layout: a slim announcement bar (an offer plus a link to act), a clean header (logo, search, account, cart, with navigation in a menu on phones), ONE hero with a clear headline, a single primary button, and text that stays legible over any photo (add a dark scrim if needed), then quick category shortcuts, social proof (star ratings or a customer quote), and featured products.",
  product:
    "PRODUCT PAGE layout: exactly ONE image area, either a single main photo with a small thumbnail strip, OR one carousel with small dots. NEVER show two stacked images, and NEVER put carousel arrows between two separate images. Next to the image (desktop) or below it (phone): the product title, the price, a star rating with review count directly under the title, a concise scannable description (a sentence or two plus a few short bullets for care, size, specs), ONE clear add-to-cart button, and a short trust/shipping line. If the item is sold out, show a clear 'notify me' option and a link to similar in-stock products.",
  collection:
    "COLLECTION PAGE layout: a clean, even grid of product cards, each with an image, title, price, and rating, all the same size and structure. Simple sort/filter controls at the top and a short category intro line. Do not mix card styles.",
  cart:
    "CART / SLIDE-CART layout: each line item shows a thumbnail, title, chosen variant, price, and a quantity stepper. A clear subtotal, a single prominent checkout button, a free-shipping progress line when relevant, and a short reassurance line (easy returns / secure checkout). An optional 'you may also like' row is fine, shown once.",
};

/** Page-specific layout brief plus the general layout rules, for prompt injection. */
export function layoutGuidance(kind: WebPageKind): string {
  return `${LAYOUT_BRIEF[kind]} ${GENERAL_LAYOUT_RULES}`;
}
