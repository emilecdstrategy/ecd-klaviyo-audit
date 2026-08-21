// Run with: npx deno test --allow-read supabase/functions/_shared/
//
// Every message below is real, taken from a job row that actually failed. The
// point of this file is that the retry decision can never again be silently
// disabled: the old inline regexes classified NOTHING with a status code as
// transient for months, because their word boundaries had been mangled into
// backspace control characters, and no test existed to notice.
import { isTransientError } from "./transient-errors.ts";

function assert(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

const RETRY = [
  // The one that started this: a HigherDOSE profile scan, 922,846 profiles in,
  // killed by a dropped connection. Classified permanent for 16 minutes while
  // the report told the reader a scan was in progress.
  "TypeError: error sending request from [2600:1f16:14f1:d508::]:35204 for https://a.klaviyo.com/api/profiles/ ([2606:4700::]:443): client error (SendRequest): connection error: connection reset",
  "connection reset",
  "ECONNRESET",
  "socket hang up",
  "fetch failed",
  "upstream 502 bad request",
  "HTTP 429 rate limited",
  "429 Too Many Requests",
  "503 Service Unavailable",
  "504 gateway timeout",
  "Klaviyo returned 500",
  "request timeout after 30s",
  "server is temporarily overloaded",
  "stream closed unexpectedly",
  "TLS handshake failure",
];

const DO_NOT_RETRY = [
  // Permanent: retrying four times only delays telling somebody the truth.
  "403: missing profiles:read scope",
  "Invalid API key",
  "401 unauthorized",
  "The api key has been revoked",
  "invalid cursor supplied",
  "malformed request body",
  // Not a status code, just a number that contains one.
  "processed 5024 profiles then stopped for an unknown reason",
  "order 45029 could not be parsed",
  // Nothing to go on.
  "",
  "   ",
];

Deno.test("real transient failures are retried", () => {
  for (const message of RETRY) {
    assert(isTransientError(message), `should retry: ${message.slice(0, 70)}`);
  }
});

Deno.test("permanent failures are not retried", () => {
  for (const message of DO_NOT_RETRY) {
    assert(!isTransientError(message), `should NOT retry: ${JSON.stringify(message.slice(0, 70))}`);
  }
});

Deno.test("a permanent reason wins over a retryable-looking number", () => {
  // A 403 body explaining a missing scope mentions a status code. Reading the
  // number and ignoring the sentence would retry it forever.
  assert(!isTransientError("403 Forbidden: missing scope profiles:read"), "scope error retried");
  assert(!isTransientError("500: invalid api key"), "bad key retried");
});

Deno.test("no source file carries control characters", () => {
  // The mechanism behind the original bug: \b typed into a double-quoted shell
  // string becomes byte 0x08. It compiles, it typechecks, and the regex it lands
  // in matches nothing. This catches it across the whole function tree rather
  // than in the one regex that got noticed.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
        const text = Deno.readTextFileSync(path);
        // Tab, newline and carriage return are legitimate; nothing else is.
        if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) offenders.push(path);
      }
    }
  };
  walk("supabase/functions");
  assert(offenders.length === 0, `control characters in: ${offenders.join(", ")}`);
});
