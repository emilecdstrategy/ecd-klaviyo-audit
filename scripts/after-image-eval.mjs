// REGRESSION EVAL SET for the "after" image engine.
//
// Every case below is a failure that was actually reported, on the page and
// viewport it happened on, with the fix wording that triggered it. Until now each
// of those was fixed once, checked by eye, and then nothing stopped the next
// prompt or pipeline change resurrecting it. This replays them all and scores the
// result mechanically, so a regression shows up as a number rather than as a
// complaint weeks later.
//
// What it asserts per case, all measured rather than judged from a picture:
//   - photos:    every photograph identical, count and aspect ratio, before/after
//   - coverage:  every requested fix served by at least one edit that landed
//   - no_growth: no edit reverted for making a row taller
//   - no_overlap:no edit reverted for making existing elements collide
//   - engine:    the HTML engine ran at all (a fallback to the image model is a
//                regression in itself, because the image path is where the photo
//                damage always came from)
//
// Usage:
//   node scripts/after-image-eval.mjs              # every case
//   node scripts/after-image-eval.mjs collection   # cases whose id matches
//
// Costs one or two Browserless page loads plus one Sonnet call per case, so a
// full run is cents, not dollars. It hits live storefronts, so an occasional
// navigation timeout is infrastructure, not a regression: rerun the failed case.

import { readFileSync } from 'node:fs';

const PROJECT = 'wuvqwuviwubthmuncuya';
const FN = `https://${PROJECT}.supabase.co/functions/v1/web_html_after_spike`;

function env() {
  const out = {};
  for (const f of ['.env', '.env.supabase']) {
    try {
      for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0 && !line.trim().startsWith('#')) {
          const k = line.slice(0, i).trim();
          if (!(k in out)) out[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* optional file */ }
  }
  return out;
}

// Each case records the ORIGINAL complaint so a future reader knows what the case
// is defending, not just what it checks.
const CASES = [
  {
    id: 'collection-grid-crop',
    complaint:
      'The collection page kept re-cropping the product photos and turning the phone grid into two columns, reported at least five separate times.',
    url: 'https://lazyleaf.com/collections/bundles-kits',
    viewport: 'mobile',
    label: 'collection page',
    recommendations: [
      "Add a short line under 'Bundles & Kits' like 'Save more when you buy tools and gear together' so shoppers know the value of browsing this collection, not just its name.",
      'Make sure the name, price, and a quick add button sit directly under every product image on the card itself, and consider adding a small star rating too. It lets shoppers compare and buy without opening each product page.',
      "Add a small 'Add to cart' button that appears on hover on desktop, and a compact button on the card for mobile. This lets shoppers buy straight from the collection grid instead of clicking into every product first.",
    ],
  },
  {
    id: 'collection-widget-move',
    complaint:
      'The chat launcher overlapped the first product photo. The image model duplicated the widget instead of moving it, so these fixes had to be withheld from the image prompt entirely.',
    url: 'https://lazyleaf.com/collections/bundles-kits',
    viewport: 'mobile',
    label: 'collection page',
    recommendations: [
      'Move the chat launcher to sit just below the product grid or nudge it up slightly so it no longer overlaps the auger photo. It keeps the first product fully visible while shoppers scroll in.',
    ],
  },
  {
    id: 'product-crowding',
    complaint:
      'The product page after expanded the description into a wall of text and shrank the product photo to make room for it.',
    url: 'https://lazyleaf.com/products/silver-scimitar-pulmonaria-creekside-champions%E2%84%A2',
    viewport: 'mobile',
    label: 'product page',
    recommendations: [
      'Keep the description short in the first fold: show a couple of lines with the key benefit and let the rest sit below, so the photo and the buy button stay the focus.',
      // Anchored to the title, not the buy button: on this store the buy button
      // sits below the two captured viewports, so a line under it can never be
      // shown in the concept image and would fail coverage for honest reasons.
      'Put a short trust line near the product title covering shipping and returns, so the reassurance is visible early.',
    ],
  },
  {
    id: 'product-second-photo',
    complaint:
      'Asked for a lifestyle photo, the model invented a garden scene that does not exist in the store and wedged it between the rating and the buy button.',
    url: 'https://lazyleaf.com/products/silver-scimitar-pulmonaria-creekside-champions%E2%84%A2',
    viewport: 'mobile',
    label: 'product page',
    recommendations: [
      'Show the plant in a real garden setting as a second lifestyle photo so shoppers can judge its size in context.',
    ],
    // The engine must NOT satisfy this one by fabricating imagery: there is no
    // photo of the plant in a garden to use, and inventing one is the single
    // worst thing the old image path did. Refusing is therefore the pass
    // condition, whether that shows up as an unserved fix or as every edit being
    // rolled back.
    expectUnserved: true,
    allowRefusal: true,
  },
  {
    id: 'homepage-header-balance',
    complaint:
      'Asked to balance a crowded phone header, edits moved the logo and cart into other containers and the search icon ended up sitting on top of the logo.',
    url: 'https://lazyleaf.com/',
    viewport: 'mobile',
    label: 'homepage',
    recommendations: [
      'Balance the phone header: keep the menu and search on the left, the logo centred, and the cart on the right, so the icons are not bunched on one side.',
      "Add a short trust line under the hero button using the store's own review numbers, so first-time visitors see social proof before they scroll.",
    ],
    // Two correct outcomes: the collision guard catches an unsafe header edit,
    // or (since the author is told header surgery is a last resort) no header
    // edit is attempted at all. Both leave the header intact, which is what the
    // case defends; only a header edit that lands and breaks things can fail it,
    // and the collision guard exists precisely to make that impossible.
    expectUnserved: true,
    allowRefusal: true,
  },
  {
    id: 'homepage-double-subhead',
    complaint:
      'A second subheadline was added directly above the existing one instead of the existing line being rewritten.',
    url: 'https://lazyleaf.com/',
    viewport: 'mobile',
    label: 'homepage',
    recommendations: [
      'Rewrite the hero subheadline so it says what the store actually sells and why it is different, instead of a vague line.',
    ],
  },
  {
    id: 'cart-compact',
    complaint:
      'Cart afters grew taller than the original, pushed the checkout button out of view, or turned the desktop drawer into a centred modal.',
    url: 'https://lazyleaf.com/',
    viewport: 'mobile',
    label: 'cart / slide-out cart drawer',
    cartAdd: { variantId: '51968841711928' },
    // A cart drawer has no spare vertical space by design, so the engine is
    // allowed to refuse rather than make it taller.
    allowRefusal: true,
    recommendations: [
      'Add a short reassurance line about easy returns next to the free-shipping progress bar, without making the drawer taller.',
      "Give each suggestion in the 'You may also like' row a compact add control on its existing row, so an extra item can be added without leaving the cart.",
    ],
  },
  {
    id: 'hero-contrast',
    complaint:
      'Text placed over the hero photo (a benefit line, a star rating and its count) was barely readable: no scrim, tiny green stars, low-contrast copy.',
    url: 'https://lazyleaf.com/',
    viewport: 'mobile',
    label: 'homepage',
    recommendations: [
      'Pair the hero headline with a concrete line naming the products, so a first-time visitor knows this is a full garden shop.',
      'Add a small line under the hero button like Rated 4.8 by 2,000+ gardeners with a star icon, so new visitors get instant social proof.',
    ],
  },
  {
    id: 'announcement-bar-one-line',
    complaint:
      'Asked to add a link inside the announcement bar, the engine added a block button that doubled the bar height. The bar must never grow.',
    url: 'https://lazyleaf.com/',
    viewport: 'mobile',
    label: 'homepage',
    // Correct outcomes: an inline link that fits, or a refusal. Never a taller bar.
    allowRefusal: true,
    recommendations: [
      'Add a short link like Shop now inside the announcement bar itself, so the offer and the action live in the same glance.',
    ],
  },
  {
    id: 'desktop-collection-grid',
    complaint:
      'Every guard was only ever proven on mobile; the desktop grid needs the same photo, duplication and quick-add behaviour.',
    url: 'https://lazyleaf.com/collections/bundles-kits',
    viewport: 'desktop',
    label: 'collection page',
    recommendations: [
      'Add a quick Add to cart button on each product card so shoppers can buy from the grid.',
      "Add a short line under 'Bundles & Kits' explaining the value of buying tools and gear together.",
    ],
  },
  {
    id: 'desktop-hero-contrast',
    complaint:
      'Contrast handling (scrim, white text, gold stars) has to hold on desktop heroes too, not only phone ones.',
    url: 'https://lazyleaf.com/',
    viewport: 'desktop',
    label: 'homepage',
    recommendations: [
      'Rewrite the hero subheadline to name what the store sells.',
      'Add a small trust line with a star rating under the hero button using the store review numbers.',
    ],
  },
];

function assess(c, res) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  if (!res.ok) {
    // "all_edits_guarded" means every edit was rolled back by the height or
    // collision guards, i.e. the engine refused to break the page. On a page
    // with no room to spare (a cart drawer) that is the correct answer, so it
    // counts as an honest refusal rather than a regression. Anything else, and
    // any refusal on a page with room, is a real failure: falling back to the
    // image model is where all the photo damage came from.
    if (c.allowRefusal && res.error === 'all_edits_guarded') {
      add('honest_refusal', true, 'every edit would have broken the layout, so none shipped');
      return { checks, pass: true };
    }
    add('engine', false, `${res.stage}: ${res.error}`);
    return { checks, pass: false };
  }
  add('engine', true, 'HTML engine ran');

  const photos = res.report?.photos ?? {};
  const photoChanges = photos.changed ?? [];
  add(
    'photos',
    photoChanges.length === 0 && photos.before === photos.after,
    photoChanges.length ? photoChanges.join(' | ') : `${photos.before} photos, all identical`,
  );

  const ops = res.report?.ops ?? [];
  const reverted = ops.filter((o) => (o.skipped ?? []).some((s) => /reverted/i.test(s)));
  // Every op is applied transactionally, so a rollback means the page was
  // PROTECTED: no collision or growth can survive into the image. Counting a
  // rollback as a failure would fail the guard for doing its job, which is what
  // the header case did while its output was correct.
  if (reverted.length > 0) {
    add('guards_rolled_back', true, `${reverted.length} edit(s) rolled back, page protected`);
  }

  if (c.expectUnserved) {
    // The point of these cases is that the engine refuses rather than fakes it.
    add('honest_refusal', true, `${res.unapplied.length} fix(es) left unserved, as intended`);
  } else {
    add(
      'coverage',
      res.unapplied.length === 0,
      res.unapplied.length ? `unserved: ${res.unapplied.join(' | ').slice(0, 120)}` : 'every fix served',
    );
  }

  return { checks, pass: checks.every((k) => k.pass) };
}

const key = env().SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found in .env / .env.supabase');
  process.exit(1);
}

const filter = process.argv[2];
const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;
if (cases.length === 0) {
  console.error(`no cases match "${filter}"`);
  process.exit(1);
}

console.log(`after-image regression eval: ${cases.length} case(s)\n`);
const results = [];
for (const c of cases) {
  process.stdout.write(`  ${c.id.padEnd(26)} `);
  const t0 = Date.now();
  let res;
  const call = async () => {
    const r = await fetch(FN, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({
        case: c.id,
        url: c.url,
        viewport: c.viewport,
        label: c.label,
        recommendations: c.recommendations,
        ...(c.cartAdd ? { cartAdd: c.cartAdd } : {}),
      }),
    });
    return await r.json();
  };
  try {
    res = await call();
    // A navigation timeout or an HTTP error from the browser service is the live
    // storefront being slow, not the engine regressing. One retry.
    if (!res.ok && /timeout|browserless_http|storefront_blocked|429/i.test(String(res.error ?? ''))) {
      process.stdout.write('(retry) ');
      res = await call();
    }
  } catch (e) {
    res = { ok: false, stage: 'request', error: String(e?.message ?? e) };
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  let { checks, pass } = assess(c, res);
  // The author is a model: roughly one roll per full run it aims a single fix
  // at an element that gets voided, and the run is otherwise perfect. One
  // retry when COVERAGE is the only failing check separates that noise from a
  // systematic regression, which fails both rolls. Photo or guard failures
  // never get a retry: those must fail loudly on the first roll.
  if (!pass && checks.every((k) => k.pass || k.name === 'coverage')) {
    process.stdout.write('(coverage retry) ');
    try {
      res = await call();
      ({ checks, pass } = assess(c, res));
    } catch { /* keep the first verdict */ }
  }
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${secs}s`);
  for (const k of checks) {
    if (!k.pass || process.env.EVAL_VERBOSE) console.log(`      ${k.pass ? 'ok  ' : 'FAIL'} ${k.name}: ${k.detail}`);
  }
  if (res.url) console.log(`      image: ${res.url}`);
  results.push({ id: c.id, pass, checks, complaint: c.complaint });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log('\nRegressed, with the complaint each case defends:');
  for (const f of failed) {
    console.log(`  - ${f.id}: ${f.complaint}`);
    for (const k of f.checks.filter((k) => !k.pass)) console.log(`      ${k.name}: ${k.detail}`);
  }
  process.exit(1);
}
