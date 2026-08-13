// THE KILL SWITCH for web-audit "after" concept images.
//
// Turned OFF on 2026-08-13 by a product decision: web audit reports ship the
// findings and the client's own "before" screenshots, with no redesign mockups.
// The image model could not hold a photo, a price or a product title steady
// often enough to be worth the spend, and a withheld concept reads as a broken
// report. Every piece of the pipeline is intact behind this flag: the
// compositor, the text locks, the verifiers, the retry ladder and the report UI.
//
// TO TURN IT BACK ON (one command, no deploy):
//   npx supabase secrets set WEB_AFTER_IMAGES=on --project-ref <ref>
// then flip WEB_AFTER_IMAGES_ENABLED in src/lib/feature-flags.ts so the report
// renders what the server starts producing again. Both layers must agree.
//
// While it is off, in ORDER OF WHAT COSTS MONEY:
//  - web_generate_after refuses at the door, so no Gemini call can happen, from
//    the auto chain, the pg_cron watchdog, the editor button or the assistant.
//  - web_finalize_analysis never kicks the chain and never sets
//    web_afters_ready = false, which is also what keeps the watchdog's
//    after-image phase from finding any candidate (it selects on that flag).
//  - web_capture_screenshots skips the second-fold screenshot, which existed
//    only as context for the generator: 6 fewer Browserless shots per audit.
export function afterImagesEnabled(): boolean {
  return (Deno.env.get("WEB_AFTER_IMAGES") ?? "").trim().toLowerCase() === "on";
}
