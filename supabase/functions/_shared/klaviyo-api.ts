/** Klaviyo REST API base URL. */
export const KLAVIYO_BASE = "https://a.klaviyo.com";

/**
 * Klaviyo API revision header (`revision`).
 * Update when upgrading — https://developers.klaviyo.com/en/docs/changelog_
 * Latest GA revision as of 2026-06-10.
 */
export const KLAVIYO_REVISION = "2026-04-15";

/** Resolve revision for API calls. Uses explicit override when provided, else current GA revision. */
export function resolveKlaviyoRevision(override?: string | null): string {
  const trimmed = (override ?? "").trim();
  return trimmed || KLAVIYO_REVISION;
}
