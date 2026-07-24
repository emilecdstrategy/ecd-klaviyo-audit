// A compact e-commerce UI/UX + conversion knowledge base shared by the web-audit
// agents (findings + "after" image generation). It encodes the standard,
// shopper-familiar layout of each storefront page plus the common anti-patterns
// to avoid, so generated concepts follow real conventions instead of inventing
// odd structures (e.g. two stacked product images with carousel arrows between).

export type WebPageKind = "homepage" | "product" | "collection" | "cart";

export const GENERAL_LAYOUT_RULES = [
  "Follow standard, conventional e-commerce layouts that shoppers already recognize. Never invent unusual or experimental structures.",
  "Never duplicate a section or element: show each image, heading, button, or block once. Never stack two copies of the same image, and never place carousel arrows between two separate images.",
  "Keep one clear visual flow down the page, with related things grouped and consistent spacing and alignment.",
  "One primary action per screen; anything secondary must clearly look secondary.",
  "Every element must look finished and real: aligned, evenly padded, no empty icon slots, no placeholder or label text.",
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
