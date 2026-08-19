// Shopify bulk operations: the only way to read a whole window of orders for a
// store that fills a paginated fetch long before the window ends.
//
// The shape of the thing: you submit a query, Shopify runs it asynchronously and
// writes JSONL to a signed URL, and you stream that back. None of it fits in one
// edge invocation, so this module is split into start / poll / ingest steps a
// caller can spread across requeue passes.
import { shopifyGraphql } from "./shopify-api.ts";

/** One order, folded from its own JSONL line plus its line-item lines. */
export type BulkOrderRow = {
  created_ms: number;
  revenue: number;
  discount: number;
  units: number;
  items: Array<{
    title: string;
    revenue: number;
    units: number;
    handle: string | null;
    image: string | null;
    unit_price: number | null;
  }>;
  channel: string;
  appName: string;
  /** Who placed it. Null on guest checkouts and when read_customers is absent.
   *  A repeat rate needs identity per order, not a lifetime counter: see
   *  computeRepeat in web_fetch_snapshot. */
  customerId: string | null;
};

/** How far back a bulk read goes. Matches what the paginated path asks for, so
 * both produce the same windows and the same repeat-rate definition. */
export const BULK_WINDOW_DAYS = 180;

export type BulkStatus =
  | { state: "running"; id: string; objectCount: number }
  | { state: "complete"; id: string; url: string | null; objectCount: number; fileSize: number }
  | { state: "failed"; id: string; error: string };

/** The orders query. One nested connection (lineItems), well inside the limits of
 * two nesting levels and five connections. No first, no pageInfo: bulk rejects
 * both. */
export function ordersBulkQuery(sinceIso: string, includeCustomer: boolean): string {
  // id, not numberOfOrders: that counter is the customer's lifetime total as it
  // stands today, so it says nothing about whether they had bought before THIS
  // order. Identity plus order dates answers that properly.
  const customer = includeCustomer ? "customer { id }" : "";
  return `
    {
      orders(query: "created_at:>='${sinceIso}'", sortKey: CREATED_AT) {
        edges {
          node {
            id
            createdAt
            sourceName
            app { name }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalDiscountsSet { shopMoney { amount } }
            ${customer}
            lineItems {
              edges {
                node {
                  quantity
                  title
                  originalTotalSet { shopMoney { amount } }
                  variant { price }
                  product { handle featuredImage { url } }
                }
              }
            }
          }
        }
      }
    }
  `.trim();
}

/** Submit the query. Returns the operation id, or an error the caller can act on. */
export async function startBulkOrders(
  shopDomain: string,
  token: string,
  sinceIso: string,
  includeCustomer: boolean,
): Promise<{ ok: true; id: string } | { ok: false; error: string; alreadyRunning?: boolean }> {
  const mutation = `
    mutation Run($q: String!) {
      bulkOperationRunQuery(query: $q) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGraphql(shopDomain, token, mutation, {
    q: ordersBulkQuery(sinceIso, includeCustomer),
  });
  if (!res.ok) return { ok: false, error: `bulk_start_http_${res.status}` };
  const payload = res.body?.data?.bulkOperationRunQuery;
  const errs = (payload?.userErrors ?? []) as Array<{ message?: string }>;
  if (errs.length > 0) {
    const message = errs.map((e) => e.message ?? "").join("; ");
    // Older shops allow one query operation at a time. Worth naming, so the
    // caller can adopt the running one instead of failing the audit.
    return {
      ok: false,
      error: message,
      alreadyRunning: /already in progress|already running/i.test(message),
    };
  }
  const id = payload?.bulkOperation?.id;
  return id ? { ok: true, id: String(id) } : { ok: false, error: "bulk_start_no_id" };
}

/** Where a submitted operation has got to. */
export async function pollBulk(shopDomain: string, token: string, id: string): Promise<BulkStatus> {
  const query = `
    query Status($id: ID!) {
      node(id: $id) {
        ... on BulkOperation {
          id
          status
          errorCode
          objectCount
          fileSize
          url
        }
      }
    }
  `;
  const res = await shopifyGraphql(shopDomain, token, query, { id });
  if (!res.ok) return { state: "failed", id, error: `bulk_poll_http_${res.status}` };
  const op = res.body?.data?.node;
  if (!op) return { state: "failed", id, error: "bulk_poll_no_node" };
  const status = String(op.status ?? "");
  const objectCount = Number(op.objectCount ?? 0) || 0;
  if (status === "COMPLETED") {
    return {
      state: "complete",
      id,
      url: op.url ? String(op.url) : null,
      objectCount,
      fileSize: Number(op.fileSize ?? 0) || 0,
    };
  }
  if (status === "CREATED" || status === "RUNNING") return { state: "running", id, objectCount };
  return { state: "failed", id, error: `${status}${op.errorCode ? `: ${op.errorCode}` : ""}` };
}

/** Cancel whatever is running, so a stuck operation cannot block the next audit. */
export async function cancelBulk(shopDomain: string, token: string, id: string): Promise<void> {
  const mutation = `
    mutation Cancel($id: ID!) {
      bulkOperationCancel(id: $id) {
        bulkOperation { id status }
        userErrors { message }
      }
    }
  `;
  await shopifyGraphql(shopDomain, token, mutation, { id }).catch(() => {});
}

/** The operation this app currently has in flight on the shop, if any. */
export async function currentBulk(
  shopDomain: string,
  token: string,
): Promise<{ id: string; status: string } | null> {
  const query = `{ currentBulkOperation(type: QUERY) { id status } }`;
  const res = await shopifyGraphql(shopDomain, token, query);
  const op = res.ok ? res.body?.data?.currentBulkOperation : null;
  return op?.id ? { id: String(op.id), status: String(op.status ?? "") } : null;
}

/**
 * Stream the JSONL and fold it into per-order rows.
 *
 * Never buffers the file. A 90-day window on a busy store is tens of thousands of
 * orders and several times that many line items, which would not fit in an edge
 * function as text, let alone as parsed objects. Line items are folded into their
 * parent as they arrive, which Shopify makes safe by guaranteeing that nested
 * children always appear after their parent in the file.
 */
export async function ingestBulkOrders(
  url: string,
): Promise<{ ok: true; orders: BulkOrderRow[]; lines: number } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { ok: false, error: `bulk_download_failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok || !res.body) return { ok: false, error: `bulk_download_http_${res.status}` };

  const byId = new Map<string, BulkOrderRow>();
  // See note above the intern() call sites: without this, a 180-day window on a
  // high-volume store spends most of its memory on duplicate product strings.
  const pool = new Map<string, string>();
  const intern = (v: string): string => {
    const hit = pool.get(v);
    if (hit !== undefined) return hit;
    pool.set(v, v);
    return v;
  };
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let carry = "";
  let lines = 0;

  const handle = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    lines += 1;
    let node: Record<string, unknown>;
    try {
      node = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return; // a truncated final line is not worth failing the whole ingest
    }
    const parentId = typeof node.__parentId === "string" ? node.__parentId : null;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) return;
      const qty = Number(node.quantity) || 0;
      if (qty > 0) parent.units += qty;
      const title = String(node.title ?? "").trim();
      if (!title) return;
      const lineRevenue = Number.parseFloat(
        String((node.originalTotalSet as { shopMoney?: { amount?: unknown } } | null)?.shopMoney?.amount ?? "0"),
      );
      const unitPrice = Number.parseFloat(String((node.variant as { price?: unknown } | null)?.price ?? ""));
      const product = node.product as { handle?: unknown; featuredImage?: { url?: unknown } | null } | null;
      parent.items.push({
        title: intern(title),
        revenue: Number.isFinite(lineRevenue) ? lineRevenue : 0,
        units: qty,
        handle: typeof product?.handle === "string" ? intern(product.handle) : null,
        image: typeof product?.featuredImage?.url === "string" ? intern(product.featuredImage.url) : null,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
      });
      return;
    }
    const id = typeof node.id === "string" ? node.id : "";
    if (!id) return;
    const money = (node.currentTotalPriceSet as { shopMoney?: { amount?: unknown } } | null)?.shopMoney;
    const revenue = Number.parseFloat(String(money?.amount ?? "0"));
    const discount = Number.parseFloat(
      String((node.totalDiscountsSet as { shopMoney?: { amount?: unknown } } | null)?.shopMoney?.amount ?? "0"),
    );
    const customerId = (node.customer as { id?: unknown } | null)?.id;
    byId.set(id, {
      created_ms: new Date(String(node.createdAt ?? 0)).getTime(),
      revenue: Number.isFinite(revenue) ? revenue : 0,
      discount: Number.isFinite(discount) ? discount : 0,
      units: 0,
      items: [],
      channel: intern(String(node.sourceName ?? "")),
      appName: intern(String((node.app as { name?: unknown } | null)?.name ?? "")),
      customerId: typeof customerId === "string" ? intern(customerId) : null,
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += value;
      let nl = carry.indexOf("\n");
      while (nl !== -1) {
        handle(carry.slice(0, nl));
        carry = carry.slice(nl + 1);
        nl = carry.indexOf("\n");
      }
    }
    handle(carry);
  } catch (e) {
    return { ok: false, error: `bulk_stream_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { ok: true, orders: [...byId.values()], lines };
}
