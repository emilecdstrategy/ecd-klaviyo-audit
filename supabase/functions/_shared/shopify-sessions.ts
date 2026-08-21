// Traffic and conversion, from Shopify's own analytics.
//
// The audit's data section reported revenue, orders, AOV and repeat rate: all
// of it downstream of the thing a website audit is actually about. A store
// owner judges a site by its conversion rate, and every mobile finding is worth
// arguing for or against depending on where the traffic is. Neither number was
// in the report, so the recommendations had no denominator.
//
// This is ShopifyQL over the Admin API, which needs read_analytics. Stores
// without that scope simply return null, and the report says the figures are
// unavailable rather than inventing them.

import { shopifyGraphql } from "./shopify-api.ts";

export type SessionFunnel = {
  sessions: number;
  cart_additions: number;
  reached_checkout: number;
  completed_checkout: number;
  /** Percent, as Shopify reports it (2.4 means 2.4%). */
  conversion_rate: number | null;
};

export type DeviceSplit = { device: string; sessions: number; conversion_rate: number | null };

export type SessionsReport = {
  period_days: number;
  current: SessionFunnel;
  previous: SessionFunnel | null;
  devices: DeviceSplit[];
  /** Why there are no figures, when there are none. Recorded rather than
   *  swallowed: "no data" and "no permission" are different conversations. */
  error?: string;
};

const SESSION_METRICS =
  "sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate";

/** TEMPORARY: read the real shape of shopifyqlQuery off the live schema. The
 *  2026-04 API has no TableResponse type and parseErrors is a scalar, so the
 *  documented-from-memory shape was wrong. Removed once the query is right. */
/** One ShopifyQL query. Returns the rows as the API gives them, keyed by
 *  column name, plus the column types.
 *
 *  Written against the live 2026-04 schema rather than from memory, which was
 *  wrong in three ways: there is no TableResponse type to spread on, parseErrors
 *  is a list of plain strings, and the rows live on `rows` as a JSON scalar
 *  rather than on `rowData` as arrays. */
async function runShopifyql(
  shopDomain: string,
  token: string,
  query: string,
): Promise<{ rows: Array<Record<string, string>>; types: Record<string, string> } | { error: string }> {
  const gql = `query Ql($q: String!) {
    shopifyqlQuery(query: $q) {
      parseErrors
      tableData { rows columns { name dataType } }
    }
  }`;
  let out: { ok: boolean; status: number; body: unknown };
  try {
    out = await shopifyGraphql(shopDomain, token, gql, { q: query });
  } catch (e) {
    return { error: `request_failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) };
  }
  const body = out.body as { data?: unknown; errors?: Array<{ message?: string }> } | null;
  const errors = body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    // A store whose app lacks read_analytics arrives here, as does a schema
    // change. Both are worth reading verbatim later rather than guessing at.
    return { error: `graphql(${out.status}): ${errors.map((e) => e?.message ?? "").join("; ")}`.slice(0, 300) };
  }
  if (!out.ok) return { error: `http_${out.status}` };
  const q = (body?.data as { shopifyqlQuery?: Record<string, unknown> } | undefined)?.shopifyqlQuery;
  if (!q) return { error: "empty_response" };
  const parseErrors = q.parseErrors as string[] | undefined;
  if (Array.isArray(parseErrors) && parseErrors.length > 0) {
    return { error: `parse: ${parseErrors.join("; ")}`.slice(0, 300) };
  }
  const table = q.tableData as { rows?: unknown; columns?: Array<{ name?: string; dataType?: string }> } | undefined;
  if (!table || !Array.isArray(table.rows)) return { error: "no_rows" };
  const types: Record<string, string> = {};
  for (const c of table.columns ?? []) {
    if (c?.name) types[c.name] = String(c.dataType ?? "");
  }
  const rows = table.rows
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) flat[k] = v === null || v === undefined ? "" : String(v);
      return flat;
    });
  return { rows, types };
}

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** A rate as a whole-number percentage. Shopify types this column PERCENT and
 *  sends a fraction: 0.00646 is 0.65%, not 0.006%. Reading the type rather than
 *  guessing from the magnitude is what keeps a 0.6% store and a 60% one apart. */
function rate(raw: string | undefined, dataType: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = num(raw);
  const pct = (dataType ?? "").toUpperCase() === "PERCENT" ? n * 100 : n;
  return Math.round(pct * 100) / 100;
}

function funnelFrom(
  result: { rows: Array<Record<string, string>>; types: Record<string, string> },
): SessionFunnel | null {
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessions: num(row.sessions),
    cart_additions: num(row.sessions_with_cart_additions),
    reached_checkout: num(row.sessions_that_reached_checkout),
    completed_checkout: num(row.sessions_that_completed_checkout),
    conversion_rate: rate(row.conversion_rate, result.types.conversion_rate),
  };
}

/** Sessions, the checkout funnel and the device split for a window, plus the
 *  window before it for comparison. Never throws: an audit runs without it. */
export async function fetchSessions(
  shopDomain: string,
  token: string,
  periodDays: number,
): Promise<SessionsReport | null> {
  const d = Math.max(1, Math.round(periodDays));
  const currentQ = `FROM sessions SHOW ${SESSION_METRICS} SINCE -${d}d UNTIL today`;
  const previousQ = `FROM sessions SHOW ${SESSION_METRICS} SINCE -${d * 2}d UNTIL -${d + 1}d`;
  const deviceQ = `FROM sessions SHOW sessions, conversion_rate GROUP BY session_device_type SINCE -${d}d UNTIL today`;

  const current = await runShopifyql(shopDomain, token, currentQ);
  if ("error" in current) return { period_days: d, current: zero(), previous: null, devices: [], error: current.error };
  const currentFunnel = funnelFrom(current);
  if (!currentFunnel || currentFunnel.sessions === 0) {
    return { period_days: d, current: currentFunnel ?? zero(), previous: null, devices: [], error: "no_sessions" };
  }

  // The comparison and the split are each optional: losing one must not cost
  // the headline figure, which is the number the report is actually for.
  const [prev, dev] = await Promise.all([
    runShopifyql(shopDomain, token, previousQ),
    runShopifyql(shopDomain, token, deviceQ),
  ]);
  const previous = "error" in prev ? null : funnelFrom(prev);

  const devices: DeviceSplit[] = [];
  if (!("error" in dev)) {
    for (const row of dev.rows) {
      // The grouping column is named by the query, so find it by shape rather
      // than by a name this API version might change.
      const key = Object.keys(row).find((k) => /device/i.test(k));
      const device = key ? row[key].trim() : "";
      if (!device) continue;
      devices.push({
        device,
        sessions: num(row.sessions),
        conversion_rate: rate(row.conversion_rate, dev.types.conversion_rate),
      });
    }
    devices.sort((a, b) => b.sessions - a.sessions);
  }

  return { period_days: d, current: currentFunnel, previous: previous ?? null, devices };
}

function zero(): SessionFunnel {
  return { sessions: 0, cart_additions: 0, reached_checkout: 0, completed_checkout: 0, conversion_rate: null };
}

/** Where visitors fall out, as whole percentages of the step before. This is
 *  the part of the data a website audit can actually act on: a page fixes a
 *  drop-off, it does not fix a revenue total. */
export function dropOffs(f: SessionFunnel): Array<{ from: string; to: string; kept: number | null }> {
  const step = (a: number, b: number) => (a > 0 ? Math.round((b / a) * 1000) / 10 : null);
  return [
    { from: "visited", to: "added to cart", kept: step(f.sessions, f.cart_additions) },
    { from: "added to cart", to: "reached checkout", kept: step(f.cart_additions, f.reached_checkout) },
    { from: "reached checkout", to: "bought", kept: step(f.reached_checkout, f.completed_checkout) },
  ];
}

/** The figures as the analysis model should see them: measured, with the gaps
 *  named. Silence about a number beats a confident guess at it. */
export function sessionsEvidence(report: SessionsReport | null): string {
  if (!report || report.error || report.current.sessions === 0) {
    return "\n\nNo traffic or conversion data was available for this store, so make NO claim about sessions, conversion rate, or how much traffic is on phones. Do not estimate them.";
  }
  const c = report.current;
  const lines: string[] = [];
  lines.push(
    `Over the last ${report.period_days} days: ${c.sessions.toLocaleString("en-US")} sessions, conversion rate ${c.conversion_rate === null ? "unavailable" : `${c.conversion_rate}%`}.`,
  );
  lines.push(
    `Funnel: ${c.sessions.toLocaleString("en-US")} visited, ${c.cart_additions.toLocaleString("en-US")} added to cart, ${c.reached_checkout.toLocaleString("en-US")} reached checkout, ${c.completed_checkout.toLocaleString("en-US")} bought.`,
  );
  lines.push(
    "Step by step: " +
      dropOffs(c).map((d) => `${d.kept === null ? "unknown" : `${d.kept}%`} of those who ${d.from} then ${d.to}`).join("; ") + ".",
  );
  if (report.previous && report.previous.sessions > 0) {
    lines.push(
      `The ${report.period_days} days before that: ${report.previous.sessions.toLocaleString("en-US")} sessions, conversion rate ${report.previous.conversion_rate === null ? "unavailable" : `${report.previous.conversion_rate}%`}.`,
    );
  }
  if (report.devices.length > 0) {
    const total = report.devices.reduce((s, d) => s + d.sessions, 0);
    // One clause per device, each number labelled with what it measures.
    //
    // The compact version ("desktop 58% of sessions converting at 0.09%, mobile
    // 40% ...") got compressed into "mobile carries 40% of sessions and converts
    // far better than desktop's 58%", which reads desktop's SHARE as its rate.
    // Both numbers were right and the sentence was wrong, so the format changed
    // rather than the data.
    lines.push(
      "By device:\n" +
        report.devices
          .map((d) => {
            const share = total > 0 ? Math.round((d.sessions / total) * 100) : 0;
            const cr = d.conversion_rate === null
              ? "conversion rate unavailable"
              : `converts at ${d.conversion_rate}% (that is its conversion RATE, not its share)`;
            return `- ${d.device}: ${share}% of all sessions (that is its SHARE of traffic), and it ${cr}`;
          })
          .join("\n"),
    );
  }
  return (
    "\n\nTRAFFIC AND CONVERSION. Shopify's own analytics for this store, so these are measured:\n" +
    lines.join("\n") +
    "\n\nUse them to aim the findings. The device carrying the most sessions, and the step losing the most people, are where the work is worth most: say so with the figure rather than in general terms. Never round a conversion rate into a claim the number does not support, and never compare it to an industry average, because none was measured here.\n\nA share of traffic and a conversion rate are different measures and must never be set against each other. Never write a sentence that compares one device's share with another device's rate. When you name a percentage, say which it is: \"40% of sessions\" or \"converts at 0.47%\", never a bare percentage that could be read as either."
  );
}
