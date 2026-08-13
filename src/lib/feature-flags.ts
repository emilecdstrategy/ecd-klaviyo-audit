// TEMPORARY: Proposals is still being tested and shouldn't be visible to the
// rest of the team yet. Remove this gate (and its call sites) once it's ready
// for a wider rollout.
const PROPOSALS_BETA_EMAILS = new Set([
  'emil@ecdigitalstrategy.com',
  'zak@ecdigitalstrategy.com',
  'xiomara@ecdigitalstrategy.com',
]);

export function canSeeProposalsBeta(email: string | null | undefined): boolean {
  return PROPOSALS_BETA_EMAILS.has((email ?? '').trim().toLowerCase());
}

// Documents is available to all staff (no beta gate). Kept as a function so the
// call sites don't need to change if we ever want to re-gate it.
export function canSeeDocumentsBeta(_email: string | null | undefined): boolean {
  return true;
}

/** Web-audit "after" concept images: the report-side half of the kill switch.
 *
 * OFF since 2026-08-13 by a product decision: web audit reports ship the
 * findings and the client's own "before" screenshots, with no redesign mockups.
 * The image model could not hold a photo, a price or a product title steady
 * often enough to be worth the spend, and a withheld concept read as a broken
 * report to the client.
 *
 * Nothing is deleted. With this false the report renders the Before screenshot
 * alone, hides the generate/regenerate control, stops polling for images, and
 * drops the "Generating concept images" pipeline step. Any after image already
 * in the database stays there and reappears when this is flipped back.
 *
 * TO TURN IT BACK ON, both halves must agree:
 *   1. server: npx supabase secrets set WEB_AFTER_IMAGES=on --project-ref <ref>
 *      (see supabase/functions/_shared/after-images-enabled.ts)
 *   2. here: flip this to true and deploy the app.
 * Typed as boolean, not inferred as a literal, so both branches stay valid to
 * the compiler and neither side rots while it is switched off.
 */
export const WEB_AFTER_IMAGES_ENABLED: boolean = false;
