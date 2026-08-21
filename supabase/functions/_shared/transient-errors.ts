// Is a failure worth retrying?
//
// One definition, in one place, because the two copies that used to live inline
// in the watchdog were both silently broken in the same way and nobody noticed
// for months. See transient-errors.test.ts: every pattern here is pinned by a
// real error message that has actually come out of Klaviyo or Shopify.
//
// The bug worth remembering: both copies were written with \b word boundaries
// typed into a shell one-liner, where \b becomes the backspace control character
// rather than the two characters a regex needs. The expression still compiles and
// still typechecks, and matches nothing. So no 429 and no 5xx was ever retried,
// on profile scans or on analysis jobs, until a HigherDOSE scan died on a dropped
// connection and the digging found it.
//
// Hence: no \b anywhere below. Digit and word edges are spelled out.

/** HTTP statuses that mean "ask again later" rather than "stop asking". */
const RETRYABLE_STATUS = /(^|[^0-9])(408|425|429|500|502|503|504|509|520|521|522|523|524|529|598|599)([^0-9]|$)/;

/** Upstream saying it is busy, in words rather than a status code. */
const RETRYABLE_WORDS =
  /timed out|timeout|timing out|bad gateway|gateway time|service unavailable|temporarily|unavailable|overloaded|rate.?limit|too many requests|try again|throttl/i;

/**
 * The connection failing underneath the request.
 *
 * These throw rather than returning a status, which is exactly why they were
 * missed: code that classifies failures by status code never sees them. They are
 * also the most transient class there is, so treating one as permanent is the
 * worst possible reading of it.
 */
const RETRYABLE_CONNECTION =
  /connection (reset|closed|refused|error|aborted)|econnreset|econnrefused|econnaborted|epipe|etimedout|enotfound|socket hang ?up|error sending request|sendrequest|fetch failed|network error|stream (closed|ended) unexpectedly|premature close|tls|handshake/i;

/**
 * Failures that will never fix themselves, whatever we do. Checked FIRST, because
 * some of these mention a status code in passing and would otherwise look
 * retryable: a 403 body explaining a missing scope is not a rate limit.
 */
const PERMANENT =
  /missing.*scope|scope.*(missing|required|denied)|invalid api key|unauthorized|authentication (failed|error)|401|403 forbidden|revoked|not found|does not exist|invalid.*(cursor|filter|query|parameter)|malformed|unsupported/i;

/**
 * Whether a failure message describes something worth another attempt.
 *
 * Errs toward NOT retrying when a message looks permanent, since retrying a
 * revoked key four times just delays telling somebody the truth. Everything else
 * that names a busy upstream, a retryable status, or a broken connection gets
 * another go.
 */
export function isTransientError(message: unknown): boolean {
  const text = String(message ?? "");
  if (!text.trim()) return false;
  if (PERMANENT.test(text)) return false;
  return RETRYABLE_STATUS.test(text) || RETRYABLE_WORDS.test(text) || RETRYABLE_CONNECTION.test(text);
}
