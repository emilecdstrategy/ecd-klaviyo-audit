// The Proposals/Documents beta email gates that used to live here were replaced
// on 2026-08-14 by per-user area access (profiles.app_access, src/lib/access.ts):
// admins see everything, members see the areas an admin checked for them.

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
