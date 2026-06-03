import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  isKlaviyoSmsInactive,
  scanHtmlForCompetingSms,
  type KlaviyoSmsUsageSignals,
} from "./competing-sms-detect.ts";
import { fetchStorefrontHtml } from "./fetch-storefront-html.ts";

export type CompetingSmsScanSnapshot = {
  scanned_at: string;
  website_url: string | null;
  fetch_ok: boolean;
  fetch_status: number | null;
  fetch_error: string | null;
  detected_platforms: Array<{ id: string; name: string; markers: string[] }>;
  klaviyo_sms_active: boolean;
  should_inject_finding: boolean;
};

export async function resolveWebsiteUrlForClient(
  sb: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const [{ data: client }, { data: conn }] = await Promise.all([
    sb.from("clients").select("website_url").eq("id", clientId).maybeSingle(),
    sb.from("klaviyo_connections").select("website_url").eq("client_id", clientId).maybeSingle(),
  ]);
  const fromClient = String(client?.website_url ?? "").trim();
  const fromConn = String(conn?.website_url ?? "").trim();
  return fromClient || fromConn || null;
}

export async function runCompetingSmsWebsiteScan(params: {
  websiteUrl: string | null;
  klaviyoSignals: KlaviyoSmsUsageSignals;
}): Promise<CompetingSmsScanSnapshot> {
  const scannedAt = new Date().toISOString();
  const klaviyoSmsActive = !isKlaviyoSmsInactive(params.klaviyoSignals);

  const fetchResult = await fetchStorefrontHtml(params.websiteUrl);
  const detected = fetchResult.html ? scanHtmlForCompetingSms(fetchResult.html) : [];
  const shouldInject = detected.length > 0 && !klaviyoSmsActive;

  return {
    scanned_at: scannedAt,
    website_url: fetchResult.website_url,
    fetch_ok: fetchResult.fetch_ok,
    fetch_status: fetchResult.status,
    fetch_error: fetchResult.error,
    detected_platforms: detected,
    klaviyo_sms_active: klaviyoSmsActive,
    should_inject_finding: shouldInject,
  };
}
