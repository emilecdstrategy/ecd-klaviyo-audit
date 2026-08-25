/**
 * @vitest-environment node
 *
 * Which plays show product cards, and which products they show.
 *
 * Every case here is taken from a live Power Planter report. The play "Attach
 * the accessory to the anchor bestseller" named two products in its own
 * sentences and showed no cards at all, because matching only ever asked
 * whether a catalog title appeared verbatim in the copy, and nobody writes a
 * catalog title verbatim.
 */
import { describe, expect, it } from 'vitest';
import { playIsAboutProducts, productsNamedIn, type BasketProduct } from './web-report-details';

const product = (title: string): BasketProduct =>
  ({ title, units: 1, revenue: 1 } as unknown as BasketProduct);

// The real catalog for that store: top_products plus the pair_products the
// frontend merges in.
const CATALOG: BasketProduct[] = [
  'Ground Grabba Commercial Grade 36" Anchors (900mm) - 2 Pack',
  'Ground Grabba Commercial Grade 24" Anchors (600mm) - 2 Pack',
  'DEWALT® DCD130T1 60V MAX* Mixer/Drill With E-Clutch®',
  'Tree Planting Auger Bit (2" x Standing Lengths)',
  'Ultra HD Professional Landscape Auger Complete Bundle (7"x 28", 9" x 28" and DEWALT DCD130T1 60V MAX)',
  'Power Planter Extended Length Bulb Auger (3" x Standing Length)',
  'Garden Answer 7" Auger',
  'Garden Answer 3" Auger',
  'Auger Adapters',
  'GroundGrabba | Multi L Bracket | Adapt to Pipes, Walls, Frames & More | 3.5mm Mild Steel | Hot Dip Galvanised',
  'Adapter Pins',
].map(product);

const titles = (found: BasketProduct[]) => found.map((p) => p.title);

describe('productsNamedIn', () => {
  it('finds a product the copy names in shortened form', () => {
    // The report says "Ground Grabba 36" Anchors 2 Pack"; the catalog says
    // "Ground Grabba Commercial Grade 36" Anchors (900mm) - 2 Pack".
    const found = titles(productsNamedIn('The Ground Grabba 36" Anchors 2 Pack drove 171 units.', CATALOG));
    expect(found).toContain('Ground Grabba Commercial Grade 36" Anchors (900mm) - 2 Pack');
  });

  it('does not also return the other size of the same product', () => {
    // The 24" anchors share every word except the size, so a partial match must
    // lose to the fuller one.
    const found = titles(productsNamedIn('The Ground Grabba 36" Anchors 2 Pack drove 171 units.', CATALOG));
    expect(found).not.toContain('Ground Grabba Commercial Grade 24" Anchors (600mm) - 2 Pack');
  });

  it('finds a product whose real name sits after the brand', () => {
    // "GroundGrabba | Multi L Bracket | ..." reduces to the single word
    // "groundgrabba" if only the head is considered, and could never match.
    const found = titles(productsNamedIn('Add the Multi L Bracket as a featured add-on.', CATALOG));
    expect(found).toContain(
      'GroundGrabba | Multi L Bracket | Adapt to Pipes, Walls, Frames & More | 3.5mm Mild Steel | Hot Dip Galvanised',
    );
  });

  it('prefers the drill over a bundle that merely contains it', () => {
    // Both titles carry DCD130T1; the drill leads with it, the bundle ends with
    // it as one of three things inside.
    const found = titles(productsNamedIn('Segment past buyers of the DEWALT DCD130T1 drill.', CATALOG));
    expect(found).toContain('DEWALT® DCD130T1 60V MAX* Mixer/Drill With E-Clutch®');
    expect(found).not.toContain(
      'Ultra HD Professional Landscape Auger Complete Bundle (7"x 28", 9" x 28" and DEWALT DCD130T1 60V MAX)',
    );
  });

  it('names nothing in copy that names nothing', () => {
    expect(productsNamedIn('Change the free shipping threshold from $100 to $140.', CATALOG)).toEqual([]);
  });
});

describe('playIsAboutProducts', () => {
  const play = (title: string, insight: string, action_steps: string[]) => ({ title, insight, action_steps });

  it('shows cards on the pairing play that had none', () => {
    const anchor = play(
      'Attach the accessory to the anchor bestseller',
      'The Ground Grabba 36" Anchors 2 Pack drove 171 units and $17,098.29 in revenue over the last 30 days, but the low-cost Multi L Bracket sold only 84 units alongside it.',
      [
        'Add the Multi L Bracket as a featured add-on directly on the 36" Anchors product page.',
        "Bundle the two at a small combined discount and label it 'Complete your anchor setup'.",
        "Feature the same pairing in the cart's suggested products row for anchor buyers.",
      ],
    );
    expect(playIsAboutProducts(anchor, CATALOG)).toBe(true);
  });

  it('keeps the free shipping play empty', () => {
    const shipping = play(
      'Push the free shipping bar to $140',
      'The median order is $132.38 and the threshold sits at $100.',
      [
        'Change the free shipping threshold in shipping settings from $100 to $140.',
        'Update the announcement bar and cart messaging to state the new $140 threshold.',
      ],
    );
    expect(playIsAboutProducts(shipping, CATALOG)).toBe(false);
  });

  it('keeps the add-to-cart play empty even though every step names a product', () => {
    // The products are places to apply a generic change, not the point.
    const funnel = play(
      'Fix the add-to-cart step, not just the mix',
      'Only 1.6% of the 56,304 sessions added anything to cart, the single biggest drop.',
      [
        'Feature the top revenue product, the Ultra HD Professional Landscape Auger Complete Bundle, higher on the homepage.',
        'Add a clear price anchor to the Tree Planting Auger Bit listing, which already moved 78 units.',
        'Test a lower-priced entry item like the Adapter Pins at $5 as a homepage feature.',
      ],
    );
    expect(playIsAboutProducts(funnel, CATALOG)).toBe(false);
  });

  it('still shows cards on the basket play', () => {
    const basket = play(
      'Lift the single-item basket',
      '72.17% of orders contain only one item.',
      [
        'Pair the Garden Answer 3" Auger with the Garden Answer 7" Auger on both product pages.',
        'Prompt the same pairing in the cart drawer when either Garden Answer auger is added.',
      ],
    );
    expect(playIsAboutProducts(basket, CATALOG)).toBe(true);
  });

  it('shows nothing when there is no catalog to match against', () => {
    expect(playIsAboutProducts(play('x', 'y', ['z']), [])).toBe(false);
  });
});
