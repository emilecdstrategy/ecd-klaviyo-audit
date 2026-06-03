/**
 * Keep in sync with supabase/functions/_shared/competing-sms-detect.ts
 */
export type CompetingSmsPlatform = {
  id: string;
  name: string;
  markers: string[];
};

export const COMPETING_SMS_PLATFORMS: CompetingSmsPlatform[] = [
  { id: "postscript", name: "Postscript", markers: ["sdk.postscript.io", "postscript.io/sdk", "window.postscript", "bicp-analytics.postscript.io"] },
  { id: "attentive", name: "Attentive", markers: ["attentivemobile.com", "cdn.attn.tv", "attn.tv", "attentivecdn.com", "creatives.attn.tv"] },
  { id: "yotpo_sms", name: "Yotpo SMS", markers: ["smsbump.com", "yotpo.com/sms", "yotpo-sms"] },
  { id: "emotive", name: "Emotive", markers: ["emotive.io", "emotivecdn.io", "goemotive.com"] },
  { id: "recart", name: "Recart", markers: ["recart.com", "recart.me", "cdn.recart.com"] },
  { id: "omnisend", name: "Omnisend", markers: ["omnisend.com", "omnisrc.com", "soundestlink.com"] },
  { id: "listrak", name: "Listrak", markers: ["listrak.com", "listrakbi.com", "ltkm.io"] },
  { id: "sendlane", name: "Sendlane", markers: ["sendlane.com", "sendlane.net"] },
  { id: "textr", name: "TextR", markers: ["textrapp.com", "textr.io"] },
  { id: "simpletexting", name: "SimpleTexting", markers: ["simpletexting.com"] },
  { id: "slicktext", name: "SlickText", markers: ["slicktext.com", "slicktext.io"] },
  { id: "wunderkind", name: "Wunderkind", markers: ["wknd.ai", "bouncex.net", "wunderkind.co"] },
  { id: "cartloop", name: "Cartloop", markers: ["cartloop.io"] },
  { id: "tone", name: "Tone", markers: ["tonefunnel.com", "usetone.com"] },
];

export type CompetingSmsDetection = {
  id: string;
  name: string;
  markers: string[];
};

export function scanHtmlForCompetingSms(html: string): CompetingSmsDetection[] {
  if (!html?.trim()) return [];
  const haystack = html.toLowerCase();
  const found: CompetingSmsDetection[] = [];
  for (const platform of COMPETING_SMS_PLATFORMS) {
    const hits = platform.markers.filter((m) => haystack.includes(m.toLowerCase()));
    if (hits.length) {
      found.push({ id: platform.id, name: platform.name, markers: hits });
    }
  }
  return found;
}

export function normalizeStorefrontUrl(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProto);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export type KlaviyoSmsUsageSignals = {
  sms_revenue_30d: number | null;
  sms_subscribed_profiles: number | null;
  has_live_sms_named_flow: boolean;
};

export function isKlaviyoSmsInactive(signals: KlaviyoSmsUsageSignals): boolean {
  const smsRevenue = Number(signals.sms_revenue_30d ?? 0);
  if (smsRevenue >= 50) return false;
  const smsSubs = Number(signals.sms_subscribed_profiles ?? 0);
  if (smsSubs >= 25) return false;
  if (signals.has_live_sms_named_flow && smsRevenue > 0) return false;
  return true;
}
